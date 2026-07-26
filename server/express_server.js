const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const https = require('https');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { updateUserData } = require('./update_user_data');
const updateScore = require('./update_score');
const { getTopCollectionName } = require('./collectionNames');
const { getDb, closeMongo } = require('../Discord_Bot/lib/mongo');

const friendsWebhook = require('../Discord_Bot/scripts/friends_webhook');

const app = express();
app.use(express.json());

/**
 * SEGA's image hosts serve art on a non-standard TLS chain.
 *
 * This used to be handled by setting NODE_TLS_REJECT_UNAUTHORIZED=0 at the top
 * of the file, which disabled certificate verification for *every* outgoing
 * request in the process — MongoDB and Discord webhooks included. Node's global
 * fetch has no per-request agent option, so image downloads go through
 * https.get with a relaxed agent scoped to those hosts only.
 */
const relaxedAgent = new https.Agent({ rejectUnauthorized: false });
const RELAXED_TLS_HOSTS = /(^|\.)(maimaidx(-eng)?\.(jp|com)|maimai\.sega\.jp)$/;

/** Downloads a binary body, relaxing TLS verification for SEGA hosts only. */
function fetchBinary(url, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (err) {
            reject(new Error(`invalid url: ${err.message}`));
            return;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            reject(new Error('only http(s) urls are supported'));
            return;
        }

        const transport = parsed.protocol === 'https:' ? https : require('http');
        const options = RELAXED_TLS_HOSTS.test(parsed.hostname) ? { agent: relaxedAgent } : {};

        transport
            .get(parsed, options, (res) => {
                const { statusCode = 0, headers } = res;
                if (statusCode >= 300 && statusCode < 400 && headers.location && redirectsLeft > 0) {
                    res.resume();
                    resolve(fetchBinary(new URL(headers.location, parsed).toString(), redirectsLeft - 1));
                    return;
                }
                if (statusCode < 200 || statusCode >= 300) {
                    res.resume();
                    reject(Object.assign(new Error(`upstream returned ${statusCode}`), { statusCode }));
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        buffer: Buffer.concat(chunks),
                        mime: headers['content-type'] || 'image/jpeg',
                    })
                );
            })
            .on('error', reject);
    });
}

/** Fetches a URL and returns it as a base64 data: URL. */
async function toDataUrl(url) {
    const { buffer, mime } = await fetchBinary(url);
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

// Single shared MongoClient for the process (see Discord_Bot/lib/mongo.js)
const getDatabase = getDb;

// API endpoints for users and scores (username = 'ryan' or friendIdx as string: '0','1',...)
app.get('/users', async (req, res) => {
    try {
        const db = await getDatabase();
        const collection = db.collection('user_info');
        const users = await collection.find({}).sort({ _id: -1 }).toArray();

        // Group by user (id = 'ryan' or friendIdx string) and keep latest entry per user
        const userMap = new Map();
        users.forEach((user) => {
            const id = user.user != null ? String(user.user) : user.friendIdx;
            if (id !== undefined && id !== null && !userMap.has(String(id))) {
                userMap.set(String(id), { ...user, user: String(id) });
            }
        });

        res.json(Array.from(userMap.values()));
    } catch (err) {
        console.error('[server] /users error:', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

app.get('/users/:username/top-score', async (req, res) => {
    try {
        const { username } = req.params;
        // Validate before touching Mongo, so a bad id returns 400 rather than
        // failing later as a 500.
        const id = username === 'ryan' ? 'ryan' : username; // friendIdx from link (e.g. 6020500221031)
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ success: false, error: 'invalid user id' });
        }
        const db = await getDatabase();
        const collection = db.collection(collectionName);

        const topScore = await collection.findOne({}, { sort: { _id: -1 } });
        
        if (!topScore) {
            return res.status(404).json({ success: false, error: 'No top score found' });
        }
        
        res.json(topScore);
    } catch (err) {
        console.error('[server] /users/:username/top-score error:', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

// Fetch plays by date.
// Supported input formats:
//   - "YYYY-MM-DD" (from HTML date inputs)
//   - "DD/MM"      (day & month only)
//   - "DD/MM/YYYY"
app.get('/users/:username/scores-by-date', async (req, res) => {
    try {
        const { username } = req.params;
        let { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'missing date parameter (format: YYYY-MM-DD, DD/MM, or DD/MM/YYYY)' });
        }
        // Normalise the incoming date into the prefix stored in MongoDB.
        // Top score documents currently use "DD/MM/YYYY HH:mm:ss".
        let searchPrefix = date;

        // HTML date input: "YYYY-MM-DD" → "DD/MM/YYYY"
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const [y, m, d] = date.split('-');
            searchPrefix = `${d}/${m}/${y}`;
        } else if (/^\d{2}\/\d{2}$/.test(date)) {
            // "DD/MM" – allow searching by day & month only
            searchPrefix = date;
        } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
            // "DD/MM/YYYY" – already in the long form we store
            searchPrefix = date;
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
            // "D/M/YYYY" or "DD/MM/YYYY" (e.g. from history click with US-format stored date)
            searchPrefix = date;
        }
        const escapedPrefix = searchPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const id = username === 'ryan' ? 'ryan' : username;
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ error: 'invalid user id' });
        }
        const db = await getDatabase();
        const collection = db.collection(collectionName);

        // Find all records where the stored Date string starts with the requested date prefix.
        // This matches values like "21/11/2025 22:46:25" when the prefix is "21/11/2025" or "21/11".
        const records = await collection
            .find({ Date: { $regex: `^${escapedPrefix}` } })
            .sort({ _id: -1 })
            .toArray();

        if (records.length === 0) {
            // No exact match — return an empty result (frontend will display empty grid)
            return res.json({ new: [], old: [], rating: null, Date: searchPrefix });
        }

        // Return the most recent record for this date (should contain both new and old scores)
        res.json(records[0]);
    } catch (err) {
        console.error('[server] /users/:username/scores-by-date error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Rating history for a user (list of dates + ratings)
app.get('/users/:username/top-history', async (req, res) => {
    try {
        const { username } = req.params;
        const id = username === 'ryan' ? 'ryan' : username;
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ error: 'invalid user id' });
        }
        const db = await getDatabase();
        const collection = db.collection(collectionName);

        // Fetch all snapshots up to a high cap so rating history shows full range (e.g. from April 2024)
        const HISTORY_MAX = 10000;
        const history = await collection
            .find({}, { projection: { rating: 1, Date: 1 } })
            .sort({ _id: -1 })
            .limit(HISTORY_MAX)
            .toArray();

        res.json(history);
    } catch (err) {
        console.error('[server] /users/:username/top-history error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Cache for SEGA maimai songs JSON
let segaSongsCache = null;
let segaSongsCacheTime = 0;
const SEGA_CACHE_TTL = 3600000; // 1 hour in ms

async function getSegaSongs() {
    const now = Date.now();
    if (segaSongsCache && (now - segaSongsCacheTime) < SEGA_CACHE_TTL) {
        return segaSongsCache;
    }
    try {
        // Goes through fetchBinary so the SEGA host keeps its relaxed TLS agent;
        // this request previously relied on the process-wide verification bypass.
        const { buffer } = await fetchBinary('https://maimai.sega.jp/data/maimai_songs.json');
        segaSongsCache = JSON.parse(buffer.toString('utf8'));
        segaSongsCacheTime = now;
        console.log(`[server] Cached ${segaSongsCache.length} songs from SEGA`);
        return segaSongsCache;
    } catch (err) {
        console.error('[server] Failed to fetch SEGA songs:', err.message);
        return null;
    }
}

// Fetch song image from SEGA maimai database
app.get('/song-image', async (req, res) => {
    try {
        const title = req.query.title;
        if (!title) return res.status(400).json({ error: 'missing title' });
        
        const songs = await getSegaSongs();
        if (!songs || songs.length === 0) {
            return res.status(503).json({ error: 'SEGA data unavailable' });
        }
        
        // Find song by title (case-insensitive)
        const song = songs.find(s => s.title && s.title.toLowerCase() === title.toLowerCase());
        if (!song || !song.image_url) {
            return res.status(404).json({ error: 'song not found in SEGA database' });
        }
        
        const imageUrl = `https://maimaidx.jp/maimai-mobile/img/Music/${song.image_url}`;
        res.json({ image: imageUrl });
    } catch (err) {
        console.error('[server] /song-image error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Generic image → data URL proxy for avatars / misc images
app.get('/image-data', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'missing url' });

        res.json({ image: await toDataUrl(url) });
    } catch (err) {
        console.error('[server] /image-data error:', err.message);
        res.status(err.statusCode ? 502 : 500).json({ error: String(err.message || err) });
    }
});

// In-memory cache for song image data URLs (avoids re-fetching from SEGA; faster, fewer failures)
const songImageDataCache = new Map();
const SONG_IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const SONG_IMAGE_CACHE_MAX = 600;

function getCachedSongImageData(title) {
    const key = (title || '').trim().toLowerCase();
    if (!key) return null;
    const entry = songImageDataCache.get(key);
    if (!entry || Date.now() - entry.ts > SONG_IMAGE_CACHE_TTL) return null;
    return entry.dataUrl;
}

function setCachedSongImageData(title, dataUrl) {
    const key = (title || '').trim().toLowerCase();
    if (!key) return;
    if (songImageDataCache.size >= SONG_IMAGE_CACHE_MAX) {
        const oldest = [...songImageDataCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) songImageDataCache.delete(oldest[0]);
    }
    songImageDataCache.set(key, { dataUrl, ts: Date.now() });
}

// Same as /song-image but returns a data: URL so that
// html2canvas can render it safely without CORS issues.
app.get('/song-image-data', async (req, res) => {
    try {
        const title = req.query.title;
        if (!title) return res.status(400).json({ error: 'missing title' });

        const cached = getCachedSongImageData(title);
        if (cached) {
            return res.json({ image: cached });
        }

        const songs = await getSegaSongs();
        if (!songs || songs.length === 0) {
            return res.status(503).json({ error: 'SEGA data unavailable' });
        }

        const song = songs.find(s => s.title && s.title.toLowerCase() === title.toLowerCase());
        if (!song || !song.image_url) {
            return res.status(404).json({ error: 'song not found in SEGA database' });
        }

        const imageUrl = `https://maimaidx.jp/maimai-mobile/img/Music/${song.image_url}`;
        const dataUrl = await toDataUrl(imageUrl);
        setCachedSongImageData(title, dataUrl);
        res.json({ image: dataUrl });
    } catch (err) {
        console.error('[server] /song-image-data error:', err.message);
        res.status(err.statusCode ? 502 : 500).json({ error: String(err.message || err) });
    }
});

/**
 * Guards the browser-driven jobs so two callers can't run one concurrently.
 * Both the daily cron and the /scraper slash command hit these, and launching a
 * second Chromium mid-scrape produced duplicate inserts.
 */
const inFlight = new Set();

function runExclusive(name, task) {
    return async (req, res) => {
        if (inFlight.has(name)) {
            console.log(`[server] ${name} already running; rejecting duplicate trigger`);
            res.status(409).json({ success: false, error: `${name} is already running` });
            return;
        }
        inFlight.add(name);
        try {
            console.log(`[server] ${name} triggered`);
            const payload = await task(req);
            res.json({ success: true, ...payload });
        } catch (err) {
            console.error(`[server] ${name} error:`, err);
            res.status(500).json({ success: false, error: String(err) });
        } finally {
            inFlight.delete(name);
        }
    };
}

app.post(
    '/run-update-user-data',
    runExclusive('run-update-user-data', async () => ({ success: !!(await updateUserData()) }))
);

app.post(
    '/run-update-score',
    runExclusive('run-update-score', async () => ({ messages: await updateScore.runStandalone() }))
);

app.post(
    '/run-friends-webhook',
    runExclusive('run-friends-webhook', async (req) => {
        const { sendWebhook = false, saveToMongo = true, accountType = 'fy' } = req.body || {};
        const result = await friendsWebhook.run({ sendWebhook, saveToMongo, accountType });
        return { ...result, success: !!result.ok };
    })
);

const port = process.env.EXPRESS_PORT || 3000;
const server = app.listen(port, () => {
    console.log(`[server] Express server listening on port ${port}`);
});

// Close the Mongo client and stop accepting connections on container shutdown.
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        console.log(`[server] ${signal} received, shutting down`);
        server.close(() => {
            closeMongo()
                .catch(() => {})
                .finally(() => process.exit(0));
        });
    });
}

module.exports = app;
