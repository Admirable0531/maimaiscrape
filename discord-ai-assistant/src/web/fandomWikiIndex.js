const NAV_PAGE_URL = 'https://maimai.fandom.com/zh/wiki/MediaWiki:Wiki-navigation';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // the wiki's own structure changes rarely
const TIMEOUT_MS = 15000;

let cached = null; // { categories, expiresAt }

/**
 * Fandom's own curated top-nav menu — not something to guess at. Confirmed
 * by fetching the real MediaWiki:Wiki-navigation system page, which every
 * Fandom wiki uses for its nav bar. Level-1 bullets (*) are section
 * headers, sometimes linking to a page themselves; level-2 (**) are the
 * actual content pages under that section (often duplicating the level-1
 * page as the first entry — Fandom's own convention); level-3+ (***) are
 * editor/template-maintenance links, deliberately excluded here since
 * they're not informational content.
 */
function parseNavigation(wikitext) {
    const categories = [];
    let current = null;

    for (const rawLine of wikitext.split('\n')) {
        const line = rawLine.trim();
        const match = /^(\*+)(.*)$/.exec(line);
        if (!match) continue;

        const level = match[1].length;
        const [rawTitle, rawLabel] = match[2].split('|');
        const title = (rawTitle || '').trim();
        const label = (rawLabel || rawTitle || '').trim();
        if (!label) continue;

        if (level === 1) {
            current = { label, pages: [] };
            categories.push(current);
            continue;
        }
        if (level === 2 && current) {
            if (!title || /template|模板/i.test(title)) continue; // editor-only entries
            if (current.pages.some((p) => p.title === title)) continue; // Fandom's nav often repeats the level-1 page as the first level-2 entry
            current.pages.push({ title, label });
        }
        // level 3+ intentionally skipped — template/maintenance links only
    }

    return categories.filter((c) => c.pages.length > 0);
}

/**
 * At least one real entry in the wiki's own nav data is mis-authored with a
 * stray percent-encoding baked into the literal title text (`P%26A` instead
 * of `P&A` — confirmed live: the un-normalized URL 400s with `Bad title`).
 * A title should never legitimately contain a raw "%" outside this kind of
 * copy-paste artifact, so a defensive single decode — falling back to the
 * original on failure — fixes this without risking any other title, and is
 * a no-op for the (overwhelming majority) of titles with no "%" at all.
 */
function normalizeTitle(title) {
    try {
        return decodeURIComponent(title.replace(/ /g, '_'));
    } catch {
        return title.replace(/ /g, '_');
    }
}

/** Fetches (and caches) the categorized page index, with a ready-to-use wiki URL per page. */
async function loadFandomWikiIndex() {
    if (cached && Date.now() < cached.expiresAt) return cached.categories;

    let wikitext;
    try {
        wikitext = await fetchNavigationWikitext();
    } catch (err) {
        throw new Error(`Could not load the maimai Fandom wiki's page index: ${err.message}`);
    }

    const categories = parseNavigation(wikitext).map((cat) => ({
        label: cat.label,
        pages: cat.pages.map((p) => ({
            title: p.title,
            label: p.label,
            url: `https://maimai.fandom.com/zh/wiki/${encodeURIComponent(normalizeTitle(p.title))}`,
        })),
    }));

    cached = { categories, expiresAt: Date.now() + CACHE_TTL_MS };
    return categories;
}

/** action=parse doesn't return raw wikitext by default — ask for prop=wikitext explicitly, separate from fetchFandomArticle's prop=text|displaytitle. */
async function fetchNavigationWikitext() {
    const params = new URLSearchParams({
        action: 'parse',
        page: 'MediaWiki:Wiki-navigation',
        format: 'json',
        formatversion: '2',
        prop: 'wikitext',
    });
    const response = await fetch(`https://maimai.fandom.com/zh/api.php?${params.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)', Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.info || body.error.code);
    if (!body.parse || typeof body.parse.wikitext !== 'string') throw new Error('No wikitext in response.');
    return body.parse.wikitext;
}

module.exports = { loadFandomWikiIndex, NAV_PAGE_URL };
