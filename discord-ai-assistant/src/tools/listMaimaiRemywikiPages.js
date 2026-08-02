const { loadRemyWikiIndex } = require('../web/remyWikiIndex');

const declaration = {
    name: 'list_maimai_remywiki_pages',
    description:
        'Get SilentBlue.RemyWiki (silentblue.remywiki.com) organized by page type, with a ready-to-use URL for ' +
        'each — call this before guessing a URL on that wiki (its exact page-title conventions aren\'t ' +
        'guessable, e.g. some versions have no page at all). Its strength is per-version release notes: what ' +
        'changed, new areas/maps, difficulty changes, and complete songlists for a specific game version — ' +
        'generally more detailed on this than the Fandom wiki for that specific purpose. Coverage starts ' +
        'around the "1st"/PLUS era of maimai DX, not the earlier maimai (non-DX) versions. Once you find the ' +
        'right page here, fetch it with read_webpage using the url this returns.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description:
                    'Optional: only return pages under the category whose label contains this text (partial, ' +
                    'case-insensitive — e.g. "sub-page" for per-version Areas/Collection/Difficulty Changes/' +
                    'Complete Songlist pages, or "topic" for non-version-specific pages). Omit to get everything.',
            },
        },
    },
};

async function execute(args) {
    let categories;
    try {
        categories = await loadRemyWikiIndex();
    } catch (err) {
        return { success: false, error: err.message };
    }

    const filter = typeof args?.category === 'string' ? args.category.trim().toLowerCase() : '';
    const filtered = filter ? categories.filter((c) => c.label.toLowerCase().includes(filter)) : categories;

    if (filter && filtered.length === 0) {
        return {
            success: false,
            error: `No category matched "${args.category}".`,
            known_categories: categories.map((c) => c.label),
        };
    }

    return { success: true, categories: filtered };
}

module.exports = { declaration, execute };
