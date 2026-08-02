// RemyWiki is MediaWiki-powered too (confirmed live), but unlike Fandom it's
// not Cloudflare-blocked, so its content is already reachable via the
// regular read_webpage path — this module exists purely for *discovery*
// (finding the right exact page title, since guessing at RemyWiki's naming
// convention is unreliable — e.g. "maimai_DX:PiNK_PLUS" simply doesn't
// exist even though "maimai_DX:BUDDiES_PLUS" does; confirmed live).
const API_BASE = 'https://silentblue.remywiki.com/api.php';
// The "maimai DX" namespace — confirmed via siteinfo (id 3006). Covers every
// version page, per-version subpage (Areas/Collection/Difficulty Changes/
// Complete Songlist), and general topic page (Rating, Perfect Challenge,
// Friend Matching, Collection, Circle (feature), ...) — no separate
// namespace-0 query needed.
const NAMESPACE_ID = 3006;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

let cached = null; // { categories, expiresAt }

function pageUrl(title) {
    return `https://silentblue.remywiki.com/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * Splits RemyWiki's "maimai DX" namespace pages into a few obvious groups by
 * title shape, since (unlike Fandom) there's no curated nav-menu data source
 * to lean on here — just consistent naming conventions, confirmed live
 * against the real page list.
 */
function categorize(titles) {
    const versionSubpages = []; // "maimai DX:BUDDiES PLUS/Areas" etc.
    const regionalVariants = []; // "... (Asia)" / "... (China)"
    const versionPages = []; // bare "maimai DX:BUDDiES PLUS"
    const topicPages = []; // no version-name pattern: "Rating", "Perfect Challenge", ...

    for (const title of titles) {
        const withoutNamespace = title.replace(/^maimai DX:/, '');
        if (/\((Asia|China)\)$/.test(withoutNamespace)) {
            regionalVariants.push({ title, url: pageUrl(title) });
        } else if (withoutNamespace.includes('/')) {
            versionSubpages.push({ title, url: pageUrl(title) });
        } else if (/^(1st|PLUS|Splash|UNiVERSE|FESTiVAL|BUDDiES|PRiSM|CiRCLE)( PLUS)?$/.test(withoutNamespace) || /^\d{4}/.test(withoutNamespace)) {
            versionPages.push({ title, url: pageUrl(title) });
        } else {
            topicPages.push({ title, url: pageUrl(title) });
        }
    }

    return [
        { label: 'Version pages (release notes for each game version)', pages: versionPages },
        {
            label: 'Version sub-pages (Areas = chiho/maps, Collection, Difficulty Changes, Complete Songlist — per version)',
            pages: versionSubpages,
        },
        { label: 'General topic pages (not version-specific)', pages: topicPages },
        { label: 'Regional variant pages (Asia/China release differences)', pages: regionalVariants },
    ].filter((c) => c.pages.length > 0);
}

async function loadRemyWikiIndex() {
    if (cached && Date.now() < cached.expiresAt) return cached.categories;

    const titles = [];
    let apcontinue;
    do {
        const params = new URLSearchParams({
            action: 'query',
            list: 'allpages',
            apnamespace: String(NAMESPACE_ID),
            aplimit: '500',
            format: 'json',
        });
        if (apcontinue) params.set('apcontinue', apcontinue);

        let response;
        try {
            response = await fetch(`${API_BASE}?${params.toString()}`, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)', Accept: 'application/json' },
            });
        } catch (err) {
            throw new Error(`Could not load the RemyWiki page index: ${err.message}`);
        }
        if (!response.ok) throw new Error(`Could not load the RemyWiki page index: HTTP ${response.status}`);

        const body = await response.json();
        if (body.error) throw new Error(`Could not load the RemyWiki page index: ${body.error.info || body.error.code}`);

        for (const p of body.query?.allpages || []) titles.push(p.title);
        apcontinue = body.continue?.apcontinue;
    } while (apcontinue);

    const categories = categorize(titles);
    cached = { categories, expiresAt: Date.now() + CACHE_TTL_MS };
    return categories;
}

module.exports = { loadRemyWikiIndex };
