const PREVIEW_LENGTH = 200;

/**
 * Groups a loadDocument()'d page's body content into heading-bounded
 * sections via a document-order DOM walk: every heading (h1-h6) starts a new
 * section, and all text encountered before the next heading — including
 * tables, which htmlExtractor already converted to inline text — belongs to
 * it. Content before the first heading becomes an untitled leading section
 * rather than being dropped.
 *
 * The exposed heading is a breadcrumb of ancestor headings (e.g. "樂曲關連稱號
 * > ALL PERFECT"), not just the leaf text — confirmed live on a real page
 * (maimai Fandom's title list) with two *identically-named* h3 sections
 * under different h2 parents ("CiRCLE～CiRCLE+ 新增稱號 > ALL PERFECT" vs
 * "樂曲關連稱號 > ALL PERFECT", one near-empty and one the real comprehensive
 * one). Flat leaf-only headings made those indistinguishable without
 * fetching both — the model picked the wrong one and never found content
 * that was really only one section away.
 */
function splitIntoSections($) {
    const raw = [];
    let current = { breadcrumb: null, parts: [] };
    const ancestors = []; // stack of { level, text }

    const flush = () => {
        const text = current.parts.join(' ').replace(/[ \t]+/g, ' ').trim();
        if (current.breadcrumb !== null || text) raw.push({ breadcrumb: current.breadcrumb, text });
    };

    function walk(node) {
        if (node.type === 'text') {
            const text = $(node).text();
            if (text.trim()) current.parts.push(text);
            return;
        }
        // 'root' shows up as the wrapper for a <template>'s fragment content
        // (parse5's representation of the HTML5 template-content model —
        // e.g. MediaWiki skins that wrap the whole article body in a
        // <template> for client-side hydration). Recursing into it, same as
        // a 'tag', is what lets this walk see content $('h2') and $().text()
        // already reach via cheerio's own selector engine — confirmed
        // against a real page where this silently produced zero sections.
        if (node.type !== 'tag' && node.type !== 'root') return;

        const headingMatch = node.type === 'tag' && /^h([1-6])$/i.exec(node.tagName || '');
        if (headingMatch) {
            flush();
            const level = Number(headingMatch[1]);
            const text = $(node).text().trim().replace(/\s+/g, ' ');

            // Pop any ancestors at the same or deeper level — a new h3
            // replaces the previous h3 sibling but keeps its h2 parent.
            while (ancestors.length && ancestors[ancestors.length - 1].level >= level) {
                ancestors.pop();
            }
            const breadcrumb = [...ancestors.map((a) => a.text), text].join(' > ');
            ancestors.push({ level, text });

            current = { breadcrumb, parts: [] };
            return;
        }

        $(node)
            .contents()
            .each((_, child) => walk(child));
    }

    $('body')
        .contents()
        .each((_, child) => walk(child));
    flush();

    return raw
        .filter((s) => s.breadcrumb !== null || s.text.length > 0)
        .map((s, index) => ({
            id: `section-${index + 1}`,
            heading: s.breadcrumb || '(untitled section)',
            text: s.text,
        }));
}

/** The short heading+preview list sent to Gemini so it can pick sections without seeing full content. */
function toPreviews(sections) {
    return sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        preview: s.text.length > PREVIEW_LENGTH ? `${s.text.slice(0, PREVIEW_LENGTH)}…` : s.text,
    }));
}

module.exports = { splitIntoSections, toPreviews };
