const { fetchWebpage } = require('./webpageFetcher');
const { fetchRendered } = require('./playwrightFetcher');
const { loadDocument, extractMeta } = require('./htmlExtractor');
const { splitIntoSections } = require('./sectionSplitter');
const { webpageCache, maimaiAccountCache } = require('./cache');
const { getSiteConfig } = require('./siteConfig');
const { parseFandomUrl, fetchFandomArticle } = require('./fandomApi');
const { fetchAccountPage, MAIMAI_ACCOUNT_HOST, MAIMAI_ACCOUNT_PATH_PREFIX } = require('./maimaiAccountSession');
const logger = require('../utils/logger');

// Above this, read_webpage returns section previews instead of full text.
const SECTION_THRESHOLD_CHARS = 20000;
// A JS-rendered SPA shell's signature is disproportion: its raw HTML is
// non-trivial (bundled scripts, meta tags, a css link or two) but the
// visible text is tiny. Gating on text length alone misfires on pages that
// are just genuinely short — example.com is ~125 chars of real text in
// ~1.2KB of HTML, which used to trigger an unnecessary Playwright launch
// during testing. Requiring *both* low text AND a large-enough HTML payload
// avoids that false positive while still catching real SPA shells. Some
// sites still dodge this (see siteConfig.js's forcePlaywright).
const MIN_STATIC_TEXT_CHARS = 100;
const MIN_HTML_BYTES_FOR_FALLBACK = 2000;
const PLAYWRIGHT_FALLBACK_ENABLED = process.env.ENABLE_PLAYWRIGHT_FALLBACK !== 'false';

function hostnameOf(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/**
 * Fetches, extracts, and (if large) sections a page, caching the result for
 * 15 minutes keyed by both the requested and final (post-redirect) URL —
 * this is what lets read_webpage_sections retrieve full section text
 * without re-fetching, and what makes repeated read_webpage calls on the
 * same URL free within the TTL.
 */
async function loadPage(requestedUrl) {
    const cached = webpageCache.get(requestedUrl);
    if (cached) return cached;

    // Fandom articles get a dedicated path via MediaWiki's API instead of
    // the static/Playwright pipeline below — see loadFandomPage(). Checked
    // before siteConfig's blocked-host fast-fail so this actually gets a
    // chance to work for hosts (like maimai.fandom.com) that would
    // otherwise short-circuit there.
    if (parseFandomUrl(requestedUrl)) {
        return loadFandomPage(requestedUrl);
    }

    if (hostnameOf(requestedUrl).toLowerCase() === MAIMAI_ACCOUNT_HOST) {
        return loadMaimaiAccountPage(requestedUrl);
    }

    const siteConfig = getSiteConfig(hostnameOf(requestedUrl));
    if (siteConfig.blocked) {
        throw new Error(siteConfig.reason || `${hostnameOf(requestedUrl)} is known to block automated access.`);
    }

    let html;
    let finalUrl;
    let staticFetchError = null;
    try {
        const staticResult = await fetchWebpage(requestedUrl);
        html = staticResult.html;
        finalUrl = staticResult.finalUrl;
    } catch (err) {
        staticFetchError = err;
    }

    let $ = null;
    let images = [];
    if (html) {
        ({ $, images } = loadDocument(html, finalUrl));
    }
    let meta = $ ? extractMeta($, finalUrl) : { title: requestedUrl, text: '', headings: [] };
    let renderedWithBrowser = false;

    // Retry via a real browser both when the static fetch outright failed
    // (some sites — e.g. maimai.fandom.com — 403 plain HTTP clients but
    // allow real browsers) and when it succeeded but looks like an
    // unrendered JS shell, or the site is known (siteConfig) to need a
    // browser regardless of what the static fetch returned.
    const looksLikeJsShell =
        html != null &&
        meta.text.trim().length < MIN_STATIC_TEXT_CHARS &&
        Buffer.byteLength(html, 'utf8') >= MIN_HTML_BYTES_FOR_FALLBACK;
    const shouldTryPlaywright = staticFetchError !== null || looksLikeJsShell || siteConfig.forcePlaywright === true;

    if (PLAYWRIGHT_FALLBACK_ENABLED && shouldTryPlaywright) {
        logger.info(
            'web',
            staticFetchError
                ? `Static fetch of ${requestedUrl} failed (${staticFetchError.message}) — trying Playwright`
                : `Static fetch of ${requestedUrl} looked JS-rendered (${meta.text.trim().length} chars text in ` +
                      `${html.length} bytes HTML) — trying Playwright`
        );
        try {
            const rendered = await fetchRendered(requestedUrl);
            html = rendered.html;
            finalUrl = rendered.finalUrl;
            ({ $, images } = loadDocument(html, finalUrl));
            meta = extractMeta($, finalUrl);
            renderedWithBrowser = true;
            staticFetchError = null;
        } catch (err) {
            logger.warn('web', `Playwright fallback failed for ${requestedUrl}`, err);
            if (staticFetchError) throw staticFetchError; // neither path worked — surface the original (usually more informative) error
        }
    } else if (staticFetchError) {
        throw staticFetchError;
    }

    const sections = meta.text.length > SECTION_THRESHOLD_CHARS ? splitIntoSections($) : null;

    const page = {
        url: finalUrl,
        title: meta.title,
        text: meta.text,
        headings: meta.headings,
        sections,
        images,
        renderedWithBrowser,
    };

    webpageCache.set(finalUrl, page);
    if (finalUrl !== requestedUrl) webpageCache.set(requestedUrl, page);
    return page;
}

/**
 * Fandom articles via MediaWiki's action=parse API — see fandomApi.js for
 * why (the regular page is Cloudflare-blocked for both plain HTTP and a
 * headless browser; the API is a separate, unblocked path). Deliberately no
 * fallback to fetchWebpage/fetchRendered on failure: both are already known
 * to fail for these hosts, so trying them would only delay an inevitable
 * error. fetchFandomArticle() throws on any failure (bad URL shape, network
 * error, missing page, API-level error) — that propagates up to the caller
 * (tools/readWebpage.js), which turns it into a structured
 * `{success: false, error}` response. Nothing here fabricates page content
 * on failure.
 */
async function loadFandomPage(requestedUrl) {
    const { html, title } = await fetchFandomArticle(requestedUrl);

    const { $, images } = loadDocument(html, requestedUrl);
    const meta = extractMeta($, requestedUrl);
    const sections = meta.text.length > SECTION_THRESHOLD_CHARS ? splitIntoSections($) : null;

    const page = {
        url: requestedUrl, // preserve the original URL as the source, not the API endpoint
        title: title || meta.title,
        text: meta.text,
        headings: meta.headings,
        sections,
        images,
        renderedWithBrowser: false,
    };

    webpageCache.set(requestedUrl, page);
    return page;
}

/**
 * This tracked account's own maimaidx-eng.com/maimai-mobile/... pages —
 * live, authenticated in-game data (rating, records, collection, friend
 * list), fetched via maimaiAccountSession.js's shared logged-in session
 * instead of the generic fetch/Playwright pipeline (nothing on that site is
 * viewable without a real SEGA login). Cached separately from webpageCache
 * with a much shorter TTL (see cache.js) since this reflects live gameplay,
 * not a mostly-static article.
 */
async function loadMaimaiAccountPage(requestedUrl) {
    const cached = maimaiAccountCache.get(requestedUrl);
    if (cached) return cached;

    const path = new URL(requestedUrl).pathname;
    if (!path.startsWith(MAIMAI_ACCOUNT_PATH_PREFIX)) {
        throw new Error(`Only paths under ${MAIMAI_ACCOUNT_PATH_PREFIX} are supported on maimaidx-eng.com.`);
    }

    const { html, finalUrl } = await fetchAccountPage(path);
    const { $, images } = loadDocument(html, finalUrl);
    const meta = extractMeta($, finalUrl);
    const sections = meta.text.length > SECTION_THRESHOLD_CHARS ? splitIntoSections($) : null;

    const page = {
        url: finalUrl,
        title: meta.title,
        text: meta.text,
        headings: meta.headings,
        sections,
        images,
        renderedWithBrowser: true,
    };

    maimaiAccountCache.set(requestedUrl, page);
    if (finalUrl !== requestedUrl) maimaiAccountCache.set(finalUrl, page);
    return page;
}

module.exports = { loadPage };
