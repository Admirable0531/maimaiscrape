const { loadPage } = require('../web/pageLoader');
const { toPreviews } = require('../web/sectionSplitter');

const declaration = {
    name: 'read_webpage',
    description:
        'Fetch and extract the readable content of a specific URL. Only report that you read a page when ' +
        'this returns success: true — on failure, say plainly that the page could not be accessed rather than ' +
        'guessing or substituting a different source. Large pages come back as section previews instead of ' +
        'full text (large_page: true) — call read_webpage_sections with the ids of the sections you actually ' +
        "need. Also returns every image on the page (alt text + URL) — useful for \"show me X\" requests where " +
        'the page has a picture (e.g. a maimai collectible); pick the one whose alt text matches what was asked ' +
        'and include its exact URL as plain text in your reply so Discord embeds it — do not re-host, describe-' +
        'only, or invent an image URL.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'The exact URL to fetch (must start with http:// or https://).' },
        },
        required: ['url'],
    },
};

async function execute(args) {
    const url = typeof args?.url === 'string' ? args.url.trim() : '';
    if (!url) return { success: false, url, error: 'url is required.' };

    try {
        const page = await loadPage(url);
        const images = page.images || [];

        if (page.sections) {
            return {
                success: true,
                url: page.url,
                title: page.title,
                content_length: page.text.length,
                large_page: true,
                sections: toPreviews(page.sections),
                images,
            };
        }

        return {
            success: true,
            url: page.url,
            title: page.title,
            content: page.text,
            content_length: page.text.length,
            headings: page.headings.slice(0, 30),
            images,
        };
    } catch (err) {
        return { success: false, url, error: err.message };
    }
}

module.exports = { declaration, execute };
