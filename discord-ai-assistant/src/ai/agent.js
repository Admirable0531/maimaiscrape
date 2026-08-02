// Single seam for swapping the LLM backend later. Every provider must
// implement generateReply(history, userMessage, {userId, guildId}) ->
// Promise<string> — see providers/geminiProvider.js for the reference
// implementation and providers/geminiClient.js for its SDK client.
//
// This is a lightweight refactor, not a full multi-provider system: nothing
// here abstracts the tool-declaration wire format (toolDefinitions.js still
// wraps tools Gemini's way, via functionDeclarations) or the system prompt
// (systemPrompt.js is plain text, which happens to be provider-agnostic
// already). Adding a real second provider would still mean adapting those
// two, not just dropping in a new file below — this only removes the need
// to touch messageHandler.js or hunt through agent.js's old tool-loop logic
// to do it.
const logger = require('../utils/logger');

const PRIMARY_NAME = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
// Empty string disables fallback entirely (AI_PROVIDER_FALLBACK=""), e.g. if
// you want DeepSeek-only behavior instead of silently degrading to Gemini.
const FALLBACK_NAME =
    process.env.AI_PROVIDER_FALLBACK !== undefined ? process.env.AI_PROVIDER_FALLBACK.toLowerCase() : 'gemini';

const PROVIDERS = {
    gemini: () => require('./providers/geminiProvider'),
    groq: () => require('./providers/groqProvider'),
    deepseek: () => require('./providers/deepseekProvider'),
};

function loadProvider(name) {
    const factory = PROVIDERS[name];
    if (!factory) {
        throw new Error(`Unknown AI provider "${name}" — available: ${Object.keys(PROVIDERS).join(', ')}`);
    }
    return factory();
}

/**
 * Tries the primary provider first; on any failure (missing API key,
 * network error, empty/malformed response — anything generateReply()
 * throws for), falls back to a second provider rather than the whole
 * message just failing. Only triggers on an actual error, never on
 * "answer quality" — there's no reliable way to judge that automatically,
 * and guessing would silently double the cost of every reply.
 */
async function generateReply(history, userMessage, context) {
    const primary = loadProvider(PRIMARY_NAME);
    try {
        return await primary.generateReply(history, userMessage, context);
    } catch (err) {
        if (!FALLBACK_NAME || FALLBACK_NAME === PRIMARY_NAME) {
            throw err;
        }
        logger.warn(
            'agent',
            `Primary provider "${PRIMARY_NAME}" failed, falling back to "${FALLBACK_NAME}": ${err.message}`
        );
        const fallback = loadProvider(FALLBACK_NAME);
        return fallback.generateReply(history, userMessage, context);
    }
}

module.exports = { generateReply };
