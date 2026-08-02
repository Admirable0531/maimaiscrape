const { GEMINI_TOOLS, createToolExecutors } = require('../toolDefinitions');
const { SYSTEM_PROMPT } = require('../systemPrompt');
const logger = require('../../utils/logger');

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 30000;
// llama-3.3-70b-versatile: free-tier eligible, solid tool-calling accuracy —
// the closest match in quality to Gemini Flash-Lite among Groq's cheap
// models. For pure-chat-heavy usage llama-3.1-8b-instant is cheaper/faster
// but noticeably weaker at picking the right tool.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_OUTPUT_TOKENS = Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 2048;
// Mirrors geminiProvider.js's elastic tool-call budget (see its comments for
// the reasoning) so the two providers behave the same way under the same
// budget knobs, and an A/B comparison isn't skewed by one provider being
// allowed more research room than the other.
const BASE_MAX_TOOL_ITERATIONS = Number(process.env.GROQ_MAX_TOOL_ITERATIONS) || 6;
const HARD_MAX_TOOL_ITERATIONS = Number(process.env.GROQ_MAX_TOOL_ITERATIONS_HARD) || 16;
const TOOL_BUDGET_EXTEND_STEP = Number(process.env.GROQ_TOOL_BUDGET_EXTEND_STEP) || 4;

const REQUEST_MORE_TOOL_CALLS = 'request_more_tool_calls';

/**
 * toolDefinitions.js's per-tool declarations ({name, description,
 * parametersJsonSchema}) are already provider-agnostic — only the outer
 * wrapper Gemini needs ({functionDeclarations: [...]}) is Gemini-specific.
 * Re-wrapping those same declarations OpenAI's way ({type: 'function',
 * function: {...}}) avoids duplicating every tool's schema in this file.
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

function toGroqMessages(history, userMessage) {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((entry) => ({
            role: entry.role === 'assistant' ? 'assistant' : 'user',
            content: entry.content,
        })),
        { role: 'user', content: userMessage },
    ];
}

async function callGroq(messages, { toolChoice } = {}) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not set; cannot call Groq.');
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
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        throw new Error(`Could not reach the Groq API: ${err.message}`);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Groq API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json();
}

/**
 * Implements the AIProvider interface (see ../agent.js) — same contract as
 * geminiProvider.js, so agent.js's AI_PROVIDER switch can pick either without
 * touching messageHandler.js. See geminiProvider.js for the reasoning behind
 * the elastic tool-call budget mirrored here.
 */
async function generateReply(history, userMessage, { userId, guildId }) {
    const executors = createToolExecutors({ userId, guildId });
    const messages = toGroqMessages(history, userMessage);
    let maxIterations = BASE_MAX_TOOL_ITERATIONS;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const data = await callGroq(messages);
        const message = data.choices?.[0]?.message;
        const toolCalls = message?.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
            const text = (message?.content || '').trim();
            if (!text) {
                const finishReason = data.choices?.[0]?.finish_reason;
                logger.warn('agent', 'Groq returned no text and no tool calls', { finishReason });
                throw new Error(`Groq returned an empty response (finish_reason: ${finishReason ?? 'unknown'})`);
            }
            return text;
        }

        logger.info(
            'agent',
            `Groq requested ${toolCalls.length} tool call(s): ${toolCalls.map((c) => c.function.name).join(', ')}`
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
                        logger.info('agent', `Groq requested more tool-call budget: ${before} -> ${maxIterations}`);
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
    const finalData = await callGroq(messages, { toolChoice: 'none' });
    const finalText = (finalData.choices?.[0]?.message?.content || '').trim();
    if (finalText) return finalText;

    const finishReason = finalData.choices?.[0]?.finish_reason;
    logger.error(
        'agent',
        `Groq produced no final text even with tool calls disabled (finish_reason: ${finishReason ?? 'unknown'})`
    );
    return "I looked into this but couldn't put together a complete answer — try rephrasing, or ask about something more specific.";
}

module.exports = { generateReply };
