// Discovered by capturing arcade-songs.zetaraku.dev's own network traffic —
// its whole UI is a client-side app over this one static JSON file, no
// query API involved. See src/tools/searchMaimaiSongs.js for why this is
// used instead of scraping the rendered page.
const DATA_URL = 'https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json';
// Reference data (song/chart list), not live state — a few hours of
// staleness is fine, and this avoids re-downloading a multi-MB file on
// every tool call.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;

let cached = null; // { data, expiresAt }

async function loadSongData() {
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const response = await fetch(DATA_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`Failed to fetch maimai song data: HTTP ${response.status}`);
    }
    const data = await response.json();

    cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
}

module.exports = { loadSongData, DATA_URL };
