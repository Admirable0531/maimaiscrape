const { FunctionCallingConfigMode } = require('@google/genai');
const { getGeminiClient } = require('./geminiClient');
const { SYSTEM_PROMPT } = require('../systemPrompt');
const { GEMINI_TOOLS, createToolExecutors } = require('../toolDefinitions');
const logger = require('../../utils/logger');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// Bounds the tool-call round-trip loop below so a model stuck calling tools
// forever can't turn one Discord message into an unbounded number of Gemini
// requests. This is a *starting* budget, not a hard wall — see
// request_more_tool_calls below, which lets the model extend it per-message
// when a question genuinely needs more round-trips (multi-page synthesis,
// checking 2+ candidate pages) rather than raising the default for every
// message, most of which finish in 1-2 calls.
const BASE_MAX_TOOL_ITERATIONS = Number(process.env.GEMINI_MAX_TOOL_ITERATIONS) || 6;
// Absolute ceiling even after extensions — keeps a pathological back-and-forth
// from turning into an unbounded API bill for one Discord message.
const HARD_MAX_TOOL_ITERATIONS = Number(process.env.GEMINI_MAX_TOOL_ITERATIONS_HARD) || 16;
const TOOL_BUDGET_EXTEND_STEP = Number(process.env.GEMINI_TOOL_BUDGET_EXTEND_STEP) || 4;

const REQUEST_MORE_TOOL_CALLS = 'request_more_tool_calls';
// Handled inline in the loop below (it mutates loop-local budget state), not
// via toolDefinitions.js's generic executor map — it isn't a real data tool.
const requestMoreToolCallsDeclaration = {
    name: REQUEST_MORE_TOOL_CALLS,
    description:
        "Ask for more tool-call budget for this message. Each Discord message has a limited number of tool " +
        'calls; you get a low-budget warning in the tool results once you are close to running out. Call this ' +
        'ONLY if you are near/at that limit and genuinely still need more steps to finish (e.g. you are midway ' +
        'through reading several pages or synthesizing a large table) — not speculatively, and not on turn one.',
    parametersJsonSchema: { type: 'object', properties: {} },
};
// Discord truncates at 2000 chars; a reply anywhere near that is already
// unusual for a chat message. 2048 tokens gives headroom for dense CJK text
// (this community mostly deals in Japanese/Chinese song names) without
// leaving the cap effectively unbounded — paying for output that gets cut
// off client-side is pure waste.
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 2048;
// thinkingBudget: -1 = automatic (model decides per-request), 0 = disabled.
// Automatic sounds ideal but has no ceiling — a moderate fixed budget caps
// worst-case spend on this casual-chat/tool-picking bot while still leaving
// room for real reasoning across the tool set. Not disabled outright: tool
// selection accuracy benefits from at least some of it. Unverified against
// a live key — if responses feel truncated or tool picks get worse, raise
// this (or set to -1) before assuming something else is wrong.
const THINKING_BUDGET =
    process.env.GEMINI_THINKING_BUDGET !== undefined ? Number(process.env.GEMINI_THINKING_BUDGET) : 1024;

// The real tools plus the budget-extension escape hatch, declared together
// so the function-call schema Gemini sees stays identical across every
// request in a conversation (mixing tool sets mid-conversation is untested
// and not worth risking).
const TOOLS_FOR_REQUEST = [
    { functionDeclarations: [...GEMINI_TOOLS[0].functionDeclarations, requestMoreToolCallsDeclaration] },
];

/**
 * Builds Gemini's `contents` array from stored history + the new user turn.
 * Uses a stateless generateContent call (rather than ai.chats.create()'s
 * opaque session) so history can be backed by SQLite and tool round trips
 * can be appended to the same array we control.
 */
function toGeminiContents(history, userMessage) {
    return [
        ...history.map((entry) => ({
            role: entry.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: entry.content }],
        })),
        { role: 'user', parts: [{ text: userMessage }] },
    ];
}

/**
 * Manually walks the response instead of using the SDK's `.text` getter,
 * which — confirmed live — logs a warning and can return an empty string
 * when the response also contains a non-text part (e.g. a stray
 * functionCall), even when real text is present elsewhere in the same
 * response. Filtering to text parts ourselves gets that text back either way.
 */
function extractText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
}

/**
 * Implements the AIProvider interface (see ../agent.js): generateReply(history,
 * userMessage, {userId, guildId}) -> Promise<string>. Sends the conversation
 * to Gemini, executing tool calls (memory + web search/read) locally and
 * feeding results back until Gemini returns text (or the tool-call budget
 * runs out). `userId`/`guildId` come from the real Discord message, never from
 * the model — see toolDefinitions.createToolExecutors.
 */
async function generateReply(history, userMessage, { userId, guildId }) {
    const ai = getGeminiClient();
    const executors = createToolExecutors({ userId, guildId });
    const contents = toGeminiContents(history, userMessage);
    let maxIterations = BASE_MAX_TOOL_ITERATIONS;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                tools: TOOLS_FOR_REQUEST,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                thinkingConfig: { thinkingBudget: THINKING_BUDGET },
            },
        });

        const calls = response.functionCalls;
        if (!calls || calls.length === 0) {
            const text = extractText(response);
            if (!text) {
                const finishReason = response.candidates?.[0]?.finishReason;
                logger.warn('agent', 'Gemini returned no text and no function calls', { finishReason });
                throw new Error(`Gemini returned an empty response (finishReason: ${finishReason ?? 'unknown'})`);
            }
            return text;
        }

        logger.info(
            'agent',
            `Gemini requested ${calls.length} tool call(s): ${calls.map((c) => c.name).join(', ')}`
        );

        // Echo the model's own turn (containing the functionCall parts) back
        // before appending our results — contents must alternate user/model,
        // and Gemini needs to see its own call before the matching response.
        const modelContent = response.candidates?.[0]?.content;
        contents.push(modelContent ?? { role: 'model', parts: calls.map((call) => ({ functionCall: call })) });

        // Parallel — Gemini can request multiple calls in one turn (e.g.
        // search_memory + search_web together), and search_web/read_webpage
        // are network calls worth not serializing.
        const responseParts = await Promise.all(
            calls.map(async (call) => {
                if (call.name === REQUEST_MORE_TOOL_CALLS) {
                    let result;
                    if (maxIterations >= HARD_MAX_TOOL_ITERATIONS) {
                        result = {
                            success: false,
                            granted: false,
                            error: `Already at the hard cap of ${HARD_MAX_TOOL_ITERATIONS} tool calls for this message — answer with what you have.`,
                        };
                    } else {
                        const before = maxIterations;
                        maxIterations = Math.min(HARD_MAX_TOOL_ITERATIONS, maxIterations + TOOL_BUDGET_EXTEND_STEP);
                        logger.info('agent', `Gemini requested more tool-call budget: ${before} -> ${maxIterations}`);
                        result = { success: true, granted: true, new_budget: maxIterations };
                    }
                    return { functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: result } };
                }

                const executor = executors[call.name];
                let result;
                if (!executor) {
                    logger.warn('agent', `Unknown tool requested: ${call.name}`);
                    result = { success: false, error: `Unknown tool: ${call.name}` };
                } else {
                    try {
                        result = await executor(call.args || {});
                    } catch (err) {
                        logger.error('agent', `Tool ${call.name} threw`, err);
                        result = { success: false, error: 'Tool execution failed.' };
                    }
                }
                return {
                    functionResponse: {
                        name: call.name,
                        ...(call.id ? { id: call.id } : {}),
                        response: result,
                    },
                };
            })
        );

        // Nudge the model once budget is running low, so it knows the escape
        // hatch exists instead of silently hitting the forced-final-answer
        // fallback below. Only fires near the end, not every turn — no point
        // spending tokens on it for the common 1-2 call case.
        const remaining = maxIterations - (iteration + 1);
        const budgetNote =
            remaining <= 2 && remaining >= 0
                ? [
                      {
                          text: `[System note: ${remaining} of ${maxIterations} tool calls remain for this message. If you still need to keep researching, call ${REQUEST_MORE_TOOL_CALLS} before you run out; otherwise wrap up with what you have.]`,
                      },
                  ]
                : [];

        contents.push({ role: 'user', parts: [...responseParts, ...budgetNote] });
    }

    // Ran out of tool-call iterations without a final answer. The work the
    // tools already did (and the API spend that produced it) shouldn't just
    // be thrown away — force one last request the model can't ask another
    // tool call from, so it has to answer with whatever it has, even if
    // that's "I couldn't find a complete answer." Keeping `tools` declared
    // but forcing mode: NONE (rather than omitting `tools` outright) is
    // deliberate: the conversation history at this point already contains
    // functionCall/functionResponse turns, and dropping tools entirely
    // while that history remains produced a real, reproducible failure —
    // the response came back with a stray functionCall part anyway, and
    // finalResponse.text logged a warning and returned empty.
    logger.warn(
        'agent',
        `Hit ${maxIterations} tool-call iterations without a final answer — forcing a text-only reply`
    );
    const finalResponse = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: TOOLS_FOR_REQUEST,
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
    });
    const finalText = extractText(finalResponse);
    if (finalText) return finalText;

    // Belt-and-suspenders: even with tool calls barred, still fall back to a
    // real (if generic) answer instead of an opaque error reaching Discord —
    // this exact path has now misfired live more than once.
    const finishReason = finalResponse.candidates?.[0]?.finishReason;
    logger.error(
        'agent',
        `Gemini produced no final text even with tool calls disabled (finishReason: ${finishReason ?? 'unknown'})`
    );
    return "I looked into this but couldn't put together a complete answer — try rephrasing, or ask about something more specific.";
}

module.exports = { generateReply };
