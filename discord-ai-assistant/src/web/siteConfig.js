/**
 * Per-host overrides for pages whose extraction needs help beyond the
 * generic pipeline (pageLoader.js) — added only for hosts where testing
 * showed the generic heuristics get it wrong, not speculatively.
 *
 * forcePlaywright: skip the sparse-text heuristic and always render with a
 *   real browser. For sites whose static HTML has enough boilerplate UI
 *   text (filter labels, column headers) to dodge the "this looks like an
 *   empty JS shell" check even though the actual content is 100% client-
 *   rendered — confirmed on arcade-songs.zetaraku.dev, where the static
 *   fetch returns "No data available" placeholder text that's long enough
 *   to pass the generic check.
 *
 * blocked: fail fast with `reason` instead of spending ~20s retrying via
 *   Playwright on every call. For sites that block both plain HTTP clients
 *   and headless browsers outright with no other way in.
 *
 * (maimai.fandom.com used to be here as `blocked` — Cloudflare blocks the
 * regular page for both plain HTTP and a headless browser — but Fandom
 * wikis now route through the MediaWiki API instead, which isn't gated the
 * same way. See fandomApi.js / pageLoader.js's loadFandomPage(). Any
 * *.fandom.com URL is handled before this config is even consulted.)
 */
const SITE_CONFIGS = {
    'arcade-songs.zetaraku.dev': {
        forcePlaywright: true,
    },
};

function getSiteConfig(hostname) {
    return SITE_CONFIGS[(hostname || '').toLowerCase()] || {};
}

module.exports = { getSiteConfig };
