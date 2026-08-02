const cheerio = require('cheerio');

const NOISE_SELECTORS = 'script, style, noscript, nav, footer, header, iframe, svg, [aria-hidden="true"]';
// Real collection pages (frames/avatars/nameplates on the maimai Fandom
// wiki) run 139-198 <img> tags each — confirmed live. Capped well above
// that so those pages aren't silently truncated, while still bounding a
// pathological page with thousands of unrelated images.
const MAX_IMAGES = 250;

/** Renders a <table> as plain text, one row per line, cells joined with " | ". */
function tableToText($, table) {
    const rows = [];
    $(table)
        .find('tr')
        .each((_, tr) => {
            const cells = [];
            $(tr)
                .find('th, td')
                .each((__, cell) => {
                    cells.push($(cell).text().trim().replace(/\s+/g, ' '));
                });
            if (cells.length > 0) rows.push(cells.join(' | '));
        });
    return rows.join('\n');
}

/**
 * Collects <img> alt text + absolute URL. Alt text alone is usually enough
 * to identify a specific item (e.g. a maimai collectible's alt is literally
 * "Frame 百合咲ミカ" — the item type and name together), so this doesn't try
 * to correlate images with surrounding table/caption text. Prefers
 * data-src over src since lazy-loaded images often leave src pointing at a
 * placeholder until scroll-triggered.
 */
function collectImages($, baseUrl) {
    const images = [];
    $('img').each((_, el) => {
        if (images.length >= MAX_IMAGES) return false; // cheerio .each: returning false stops iteration
        const node = $(el);
        const rawSrc = node.attr('data-src') || node.attr('src');
        if (!rawSrc) return undefined;
        let url;
        try {
            url = new URL(rawSrc, baseUrl).toString();
        } catch {
            return undefined;
        }
        const alt = (node.attr('alt') || node.attr('data-image-name') || '').trim();
        images.push({ alt, url });
        return undefined;
    });
    return images;
}

/**
 * Loads HTML into cheerio, extracts images, strips noise, and converts
 * tables to inline text — in that order deliberately: noise removal first
 * so image collection skips nav/header/footer chrome (logos, ad banners),
 * then images (while they're still inside <table> cells, since collection
 * pages are table-based and the table-to-text step below would otherwise
 * destroy them — .text() on a cell containing only an <img> returns
 * nothing), then table conversion for the text-extraction pipeline.
 * Call once per page and reuse the returned `$` for both extractMeta() and
 * sectionSplitter.splitIntoSections().
 */
function loadDocument(html, baseUrl) {
    const $ = cheerio.load(html);
    $(NOISE_SELECTORS).remove();

    const images = collectImages($, baseUrl);

    $('table').each((_, table) => {
        $(table).replaceWith(`\n${tableToText($, table)}\n`);
    });

    return { $, images };
}

/** Title, flat heading list, and full readable text from an already-loadDocument()'d page. */
function extractMeta($, url) {
    const title = $('title').first().text().trim() || url;

    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text) headings.push(text);
    });

    const text = ($('body').text() || $.root().text() || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();

    return { title, text, headings };
}

module.exports = { loadDocument, extractMeta };
