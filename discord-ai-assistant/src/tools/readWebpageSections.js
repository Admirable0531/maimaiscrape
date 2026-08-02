const { loadPage } = require('../web/pageLoader');

// Matches the spec's token-optimization default of retrieving a few sections at a time.
const MAX_SECTIONS_PER_CALL = 3;

const declaration = {
    name: 'read_webpage_sections',
    description:
        'Retrieve the full text of specific sections from a large page you previously saw via read_webpage ' +
        '(large_page: true) — pass the same url and the section ids you need from its sections list. Up to ' +
        `${MAX_SECTIONS_PER_CALL} sections per call.`,
    parametersJsonSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'The same URL you passed to read_webpage.' },
            section_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Section ids from read_webpage\'s sections list, e.g. ["section-2", "section-3"].',
            },
        },
        required: ['url', 'section_ids'],
    },
};

async function execute(args) {
    const url = typeof args?.url === 'string' ? args.url.trim() : '';
    const sectionIds = Array.isArray(args?.section_ids)
        ? args.section_ids.filter((id) => typeof id === 'string')
        : [];

    if (!url) return { success: false, error: 'url is required.' };
    if (sectionIds.length === 0) return { success: false, error: 'section_ids is required.' };

    try {
        const page = await loadPage(url);
        if (!page.sections) {
            return {
                success: false,
                url: page.url,
                error: 'This page was not split into sections — call read_webpage for its full content instead.',
            };
        }

        const requested = sectionIds.slice(0, MAX_SECTIONS_PER_CALL);
        const found = [];
        const missing = [];
        for (const id of requested) {
            const section = page.sections.find((s) => s.id === id);
            if (section) found.push({ id: section.id, heading: section.heading, text: section.text });
            else missing.push(id);
        }

        return { success: true, url: page.url, sections: found, missing_section_ids: missing };
    } catch (err) {
        return { success: false, url, error: err.message };
    }
}

module.exports = { declaration, execute };
