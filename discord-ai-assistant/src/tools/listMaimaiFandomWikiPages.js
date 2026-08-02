const { loadFandomWikiIndex } = require('../web/fandomWikiIndex');

const declaration = {
    name: 'list_maimai_fandom_wiki_pages',
    description:
        'Get the maimai Fandom wiki (maimai.fandom.com) organized by real section, with a ready-to-use URL for ' +
        'each page — call this before guessing a URL or reaching for search_web on that wiki. Covers things ' +
        'search_maimai_songs and other tools don\'t: game mechanics, CIRCLE mode, challenge tracks, maps/areas ' +
        'and limited-time events (地圖、活動), Perfect Challenge, and — notably, not available on other sites — ' +
        'the collection system (蒐藏品): avatars (頭像), titles (稱號), nameplates (名牌板), backgrounds/frames ' +
        '(底板), per-song collectibles, and sound effects. Once you find the right page here, fetch it with ' +
        'read_webpage using the url this returns.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description:
                    'Optional: only return pages under the section whose label contains this text (partial, ' +
                    'case-insensitive — e.g. "collection" or "蒐藏" for the collection section). Omit to get everything.',
            },
        },
    },
};

async function execute(args) {
    let categories;
    try {
        categories = await loadFandomWikiIndex();
    } catch (err) {
        return { success: false, error: err.message };
    }

    const filter = typeof args?.category === 'string' ? args.category.trim().toLowerCase() : '';
    const filtered = filter ? categories.filter((c) => c.label.toLowerCase().includes(filter)) : categories;

    if (filter && filtered.length === 0) {
        return {
            success: false,
            error: `No section matched "${args.category}".`,
            known_categories: categories.map((c) => c.label),
        };
    }

    return { success: true, categories: filtered };
}

module.exports = { declaration, execute };
