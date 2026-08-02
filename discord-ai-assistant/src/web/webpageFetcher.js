const { assertSafeUrl } = require('./urlSafety');

const MAX_REDIRECTS = 3;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)';

/** Reads a fetch Response body, aborting once it exceeds maxBytes rather than buffering an unbounded response. */
async function readBodyCapped(response, maxBytes) {
    const reader = response.body?.getReader?.();
    if (!reader) {
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Webpage response was too large.');
        return text;
    }

    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error('Webpage response was too large.');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Fetches a URL with SSRF guards on every hop (scheme + resolved-IP checks
 * via assertSafeUrl), a bounded manual redirect chain, a response size cap,
 * and a request timeout. `redirect: 'manual'` is deliberate — letting fetch
 * auto-follow redirects would skip re-validating each hop's target.
 */
async function fetchWebpage(startUrl) {
    let currentUrl = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const parsed = await assertSafeUrl(currentUrl);

        const response = await fetch(parsed.toString(), {
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error(`HTTP ${response.status} redirect with no Location header.`);
            if (hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
            currentUrl = new URL(location, parsed).toString();
            continue;
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText || 'request failed'}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType && !contentType.includes('html') && !contentType.includes('text/')) {
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        const html = await readBodyCapped(response, MAX_BYTES);
        return { html, finalUrl: parsed.toString() };
    }

    throw new Error('Too many redirects.');
}

module.exports = { fetchWebpage };
