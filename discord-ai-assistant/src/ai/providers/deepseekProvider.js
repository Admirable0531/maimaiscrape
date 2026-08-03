const { GEMINI_TOOLS, createToolExecutors } = require('../toolDefinitions');
const { SYSTEM_PROMPT } = require('../systemPrompt');
const logger = require('../../utils/logger');

const API_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 30000;
// deepseek-v4-flash: OpenAI-compatible tool calling, cheaper than Gemini
// 3.5 Flash-Lite on both input and output, and benchmarks well specifically
// on agentic/tool-use tasks (unlike Llama-class models) — see agent.js for
// how this is wired as primary with Gemini as the fallback.
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const MAX_OUTPUT_TOKENS = Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS) || 2048;
// Mirrors geminiProvider.js's elastic tool-call budget — see its comments
// for the reasoning.
const BASE_MAX_TOOL_ITERATIONS = Number(process.env.DEEPSEEK_MAX_TOOL_ITERATIONS) || 6;
const HARD_MAX_TOOL_ITERATIONS = Number(process.env.DEEPSEEK_MAX_TOOL_ITERATIONS_HARD) || 16;
const TOOL_BUDGET_EXTEND_STEP = Number(process.env.DEEPSEEK_TOOL_BUDGET_EXTEND_STEP) || 4;

const REQUEST_MORE_TOOL_CALLS = 'request_more_tool_calls';

// DeepSeek's own defaults (confirmed against the real API docs) are
// thinking: {type: "enabled"} and reasoning_effort: "high" on every single
// call — including "hi" and "what level is Titania". Valid reasoning_effort
// values are only low/high/max (medium and xhigh are silently mapped to
// high server-side), so there are exactly three real tiers to pick from.
// Tools whose results need real interpretation (achievement-formula edge
// cases, AP/AP+ badge logic, rating math) get bumped to "max" for the turn
// that synthesizes their output; plain lookups stay at the default.
const HEAVY_REASONING_TOOLS = new Set([
    'get_maimai_score_breakdown',
    'get_maimai_song_rating',
    'get_maimai_song_ranking',
    'get_maimai_friend_scores',
]);
// Deliberately narrow and conservative — only messages that are unambiguously
// trivial (short greetings/acknowledgements with no question content) drop
// to "low". A false "low" costs quality; a missed "low" just costs a few
// cents, so this only fires on the clear-cut cases.
const TRIVIAL_MESSAGE_PATTERN = /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|lol|lmao|nice|cool|k)[!.\s]*$/i;

/** Picks a reasoning_effort for the very first call of a turn, before any tool has run — from the raw message only. */
function estimateInitialEffort(userMessage) {
    const trimmed = (userMessage || '').trim();
    if (trimmed.length > 0 && trimmed.length <= 20 && TRIVIAL_MESSAGE_PATTERN.test(trimmed)) return 'low';
    return 'high'; // DeepSeek's own default — safe middle ground when intent isn't yet known
}

/** Picks a reasoning_effort for a follow-up call, now that we know which tools the model actually reached for. */
function estimateFollowUpEffort(toolCalls) {
    const usedHeavyTool = toolCalls.some((call) => HEAVY_REASONING_TOOLS.has(call.function.name));
    return usedHeavyTool ? 'max' : 'high';
}

/**
 * toolDefinitions.js's per-tool declarations ({name, description,
 * parametersJsonSchema}) are already provider-agnostic — only the outer
 * wrapper Gemini needs ({functionDeclarations: [...]}) is Gemini-specific.
 * Re-wrapping those same declarations OpenAI's way ({type: 'function',
 * function: {...}}) avoids duplicating every tool's schema in this file.
 * (Identical approach to groqProvider.js — DeepSeek's API is OpenAI-shaped too.)
 */
const OPENAI_TOOLS = [
    ...GEMINI_TOOLS[0].functionDeclarations.map((decl) => ({
        type: 'function',
        function: {
            name: decl.name,
            description: decl.description,
            parameters: decl.parametersJsonSchema,
        },
    })),
    {
        type: 'function',
        function: {
            name: REQUEST_MORE_TOOL_CALLS,
            description:
                "Ask for more tool-call budget for this message. Each Discord message has a limited number of tool " +
                'calls; you get a low-budget warning in the tool results once you are close to running out. Call this ' +
                'ONLY if you are near/at that limit and genuinely still need more steps to finish (e.g. you are midway ' +
                'through reading several pages or synthesizing a large table) — not speculatively, and not on turn one.',
            parameters: { type: 'object', properties: {} },
        },
    },
];

function toDeepseekMessages(history, userMessage) {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((entry) => ({
            role: entry.role === 'assistant' ? 'assistant' : 'user',
            content: entry.content,
        })),
        { role: 'user', content: userMessage },
    ];
}

async function callDeepseek(messages, { toolChoice, reasoningEffort } = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not set; cannot call DeepSeek.');
    }

    let response;
    try {
        response = await fetch(API_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages,
                tools: OPENAI_TOOLS,
                tool_choice: toolChoice || 'auto',
                max_tokens: MAX_OUTPUT_TOKENS,
                // low | high | max — see the effort-estimation comment above.
                // Omitted entirely falls back to DeepSeek's own default ("high").
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        throw new Error(`Could not reach the DeepSeek API: ${err.message}`);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`DeepSeek API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json();
}

/**
 * Implements the AIProvider interface (see ../agent.js) — same contract as
 * geminiProvider.js / groqProvider.js, so agent.js's primary/fallback chain
 * can use any of them interchangeably.
 */
async function generateReply(history, userMessage, { userId, guildId }) {
    const executors = createToolExecutors({ userId, guildId });
    const messages = toDeepseekMessages(history, userMessage);
    let maxIterations = BASE_MAX_TOOL_ITERATIONS;
    // Recomputed each iteration — starts from the raw message (nothing else
    // to go on yet), then from iteration 2 onward reflects whichever tools
    // the model actually reached for on the previous turn.
    let reasoningEffort = estimateInitialEffort(userMessage);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const data = await callDeepseek(messages, { reasoningEffort });
        const message = data.choices?.[0]?.message;
        const toolCalls = message?.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
            const text = (message?.content || '').trim();
            if (!text) {
                const finishReason = data.choices?.[0]?.finish_reason;
                logger.warn('agent', 'DeepSeek returned no text and no tool calls', { finishReason });
                throw new Error(`DeepSeek returned an empty response (finish_reason: ${finishReason ?? 'unknown'})`);
            }
            return text;
        }

        reasoningEffort = estimateFollowUpEffort(toolCalls);

        logger.info(
            'agent',
            `DeepSeek requested ${toolCalls.length} tool call(s): ${toolCalls.map((c) => c.function.name).join(', ')} (next effort: ${reasoningEffort})`
        );

        messages.push(message);

        const toolMessages = await Promise.all(
            toolCalls.map(async (call) => {
                const name = call.function.name;
                let args = {};
                try {
                    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                } catch {
                    args = {};
                }

                let result;
                if (name === REQUEST_MORE_TOOL_CALLS) {
                    if (maxIterations >= HARD_MAX_TOOL_ITERATIONS) {
                        result = {
                            success: false,
                            granted: false,
                            error: `Already at the hard cap of ${HARD_MAX_TOOL_ITERATIONS} tool calls for this message — answer with what you have.`,
                        };
                    } else {
                        const before = maxIterations;
                        maxIterations = Math.min(HARD_MAX_TOOL_ITERATIONS, maxIterations + TOOL_BUDGET_EXTEND_STEP);
                        logger.info('agent', `DeepSeek requested more tool-call budget: ${before} -> ${maxIterations}`);
                        result = { success: true, granted: true, new_budget: maxIterations };
                    }
                } else {
                    const executor = executors[name];
                    if (!executor) {
                        logger.warn('agent', `Unknown tool requested: ${name}`);
                        result = { success: false, error: `Unknown tool: ${name}` };
                    } else {
                        try {
                            result = await executor(args);
                        } catch (err) {
                            logger.error('agent', `Tool ${name} threw`, err);
                            result = { success: false, error: 'Tool execution failed.' };
                        }
                    }
                }

                return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
            })
        );

        messages.push(...toolMessages);

        const remaining = maxIterations - (iteration + 1);
        if (remaining <= 2 && remaining >= 0) {
            messages.push({
                role: 'user',
                content: `[System note: ${remaining} of ${maxIterations} tool calls remain for this message. If you still need to keep researching, call ${REQUEST_MORE_TOOL_CALLS} before you run out; otherwise wrap up with what you have.]`,
            });
        }
    }

    logger.warn(
        'agent',
        `Hit ${maxIterations} tool-call iterations without a final answer — forcing a text-only reply`
    );
    const finalData = await callDeepseek(messages, { toolChoice: 'none', reasoningEffort });
    const finalText = (finalData.choices?.[0]?.message?.content || '').trim();
    if (finalText) return finalText;

    const finishReason = finalData.choices?.[0]?.finish_reason;
    logger.error(
        'agent',
        `DeepSeek produced no final text even with tool calls disabled (finish_reason: ${finishReason ?? 'unknown'})`
    );
    return "I looked into this but couldn't put together a complete answer — try rephrasing, or ask about something more specific.";
}

module.exports = { generateReply };
