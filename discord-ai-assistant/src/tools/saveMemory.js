const { saveMemory } = require('../database/repositories/memoryRepository');

const declaration = {
    name: 'save_memory',
    description:
        'Save a fact the user explicitly asked you to remember, as a key/value pair. Only call this when ' +
        'they are clearly asking you to remember something (e.g. "remember that X means Y"), not for casual mentions.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Short label for the memory, e.g. a nickname.' },
            value: { type: 'string', description: 'What the key refers to / the fact to remember.' },
            category: { type: 'string', description: 'Optional short category, e.g. "song_nickname".' },
        },
        required: ['key', 'value'],
    },
};

/** userId/guildId are bound from the real Discord message context, never from a model-supplied argument. */
function execute(args, { userId, guildId }) {
    const key = args?.key;
    const value = args?.value;
    if (typeof key !== 'string' || typeof value !== 'string') {
        return { success: false, error: 'key and value must both be strings.' };
    }
    const category = typeof args?.category === 'string' ? args.category : null;
    return saveMemory({ userId, guildId, key, value, category });
}

module.exports = { declaration, execute };
