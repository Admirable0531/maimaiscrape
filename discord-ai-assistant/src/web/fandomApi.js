// Many Fandom wikis (maimai.fandom.com confirmed) block plain HTTP clients
// AND headless browsers on the regular page (Cloudflare bot protection that
// never clears — see siteConfig.js history). MediaWiki's own action=parse
// API is a *separate* code path meant for bots/tools and is not gated the
// same way — confirmed live: 403 on the rendered page, 200 with real
// content on api.php for the same article.
const TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)';

// https://SUBDOMAIN.fandom.com/[LANG/]wiki/PAGE_TITLE — LANG is present on
// multi-language wikis (zh, ja, ...), absent on single-language ones.
const FANDOM_WIKI_PATH = /^\/(?:([a-z]{2}(?:-[a-z]+)?)\/)?wiki\/(.+)$/i;

/** Returns { hostname, lang, title, variant } for a Fandom article URL, or null if this isn't one. */
function parseFandomUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }
    if (!/\.fandom\.com$/i.test(parsed.hostname)) return null;

    const match = FANDOM_WIKI_PATH.exec(parsed.pathname);
    if (!match) return null;

    const [, lang, encodedTitle] = match;
    let title;
    try {
        title = decodeURIComponent(encodedTitle);
    } catch {
        return null; // malformed percent-encoding
    }

    return {
        hostname: parsed.hostname,
        lang: lang || null,
        title,
        variant: parsed.searchParams.get('variant'),
    };
}

/**
 * Fetches a Fandom article's rendered content via the MediaWiki API. Throws
 * on any failure (network error, HTTP error, missing page, API-level error)
 * — callers must not fall back to guessing at content on failure. The
 * language prefix in the API path matters: confirmed live that the same
 * page 404s (missingtitle) via the bare /api.php but resolves correctly via
 * /zh/api.php for a Chinese-language article.
 */
async function fetchFandomArticle(rawUrl) {
    const parsed = parseFandomUrl(rawUrl);
    if (!parsed) {
        throw new Error('Not a recognizable Fandom wiki article URL (expected /[lang/]wiki/PAGE_TITLE).');
    }

    const apiBase = `https://${parsed.hostname}/${parsed.lang ? `${parsed.lang}/` : ''}api.php`;
    const params = new URLSearchParams({
        action: 'parse',
        page: parsed.title,
        format: 'json',
        formatversion: '2',
        prop: 'text|displaytitle',
        // Without this, a redirect page (a real, common case — e.g. this
        // wiki's own nav menu links to "MURASAKi 稱號一覽", which redirects
        // to "稱號一覽") returns only a near-empty redirect stub instead of
        // the target page's actual content. Confirmed live: that exact page
        // came back as 9 characters of extracted text before this fix.
        redirects: '1',
    });
    if (parsed.variant) params.set('variant', parsed.variant);

    let response;
    try {
        response = await fetch(`${apiBase}?${params.toString()}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
    } catch (err) {
        throw new Error(`Could not reach the Fandom API: ${err.message}`);
    }

    if (!response.ok) {
        throw new Error(`Fandom API returned HTTP ${response.status}.`);
    }

    let body;
    try {
        body = await response.json();
    } catch {
        throw new Error('Fandom API returned a non-JSON response.');
    }

    if (body.error) {
        throw new Error(`Fandom API error: ${body.error.info || body.error.code}`);
    }
    if (!body.parse || typeof body.parse.text !== 'string') {
        throw new Error('Fandom API returned no page content.');
    }

    const title = String(body.parse.displaytitle || body.parse.title || parsed.title)
        .replace(/<[^>]+>/g, '') // displaytitle can carry HTML (e.g. <span class="...">Title</span>)
        .trim();

    return { html: body.parse.text, title };
}

module.exports = { parseFandomUrl, fetchFandomArticle };
