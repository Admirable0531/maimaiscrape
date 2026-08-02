const { searchCache } = require('./cache');

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 15000;
const MAX_RESULTS_CAP = 5;

/**
 * allowedDomains is enforced twice: passed to Tavily's include_domains (so
 * the search itself is scoped) AND re-checked on the returned results — a
 * safety net in case the provider ever ignores or only partially honors it.
 * "Use only this website" must hold even if the provider misbehaves.
 */
async function searchWeb({ query, allowedDomains = [], maxResults = 5 }) {
    const cappedMaxResults = Math.min(Math.max(Number(maxResults) || 5, 1), MAX_RESULTS_CAP);
    const cacheKey = JSON.stringify({ query, allowedDomains: [...allowedDomains].sort(), maxResults: cappedMaxResults });
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        throw new Error('TAVILY_API_KEY is not set; web search is unavailable.');
    }

    const body = { query, max_results: cappedMaxResults };
    if (allowedDomains.length > 0) body.include_domains = allowedDomains;

    const response = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Tavily search failed: HTTP ${response.status} ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawResults = Array.isArray(data.results) ? data.results : [];

    const filtered =
        allowedDomains.length > 0
            ? rawResults.filter((r) => {
                  try {
                      const host = new URL(r.url).hostname.toLowerCase();
                      return allowedDomains.some(
                          (d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`)
                      );
                  } catch {
                      return false;
                  }
              })
            : rawResults;

    const results = filtered.slice(0, cappedMaxResults).map((r) => ({
        title: r.title || '',
        url: r.url,
        snippet: r.content || '',
    }));
    searchCache.set(cacheKey, results);
    return results;
}

module.exports = { searchWeb };
