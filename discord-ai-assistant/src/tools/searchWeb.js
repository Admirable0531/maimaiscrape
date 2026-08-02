const { searchWeb } = require('../web/searchProvider');

const declaration = {
    name: 'search_web',
    description:
        'Search the web to discover pages that might answer the question. Returns titles, URLs, and short ' +
        "snippets — call read_webpage on a result before treating its content as verified. If the user named " +
        'a specific website or said to use only one source, pass its domain(s) in allowed_domains.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The search query.' },
            allowed_domains: {
                type: 'array',
                items: { type: 'string' },
                description:
                    'Restrict results to these domains only (e.g. ["silentblue.remywiki.com"]). Set this ' +
                    'whenever the user specified a source; leave empty otherwise.',
            },
            max_results: { type: 'integer', description: 'Maximum results to return (default 5, max 5).' },
        },
        required: ['query'],
    },
};

async function execute(args) {
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    if (!query) return { success: false, error: 'query is required.' };

    const allowedDomains = Array.isArray(args?.allowed_domains)
        ? args.allowed_domains.filter((d) => typeof d === 'string' && d.trim())
        : [];
    const maxResults = Number(args?.max_results) || 5;

    try {
        const results = await searchWeb({ query, allowedDomains, maxResults });
        return { success: true, results };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
