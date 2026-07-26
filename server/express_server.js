const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { MongoClient } = require('mongodb');

// Allow scraping sites with non-standard TLS chains (maimaidx.jp images).
// This disables certificate verification for outgoing HTTPS requests in this
// process, which is acceptable for this internal scraper API.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { updateUserData } = require('./update_user_data');
const updateScore = require('./update_score');
const { getTopCollectionName } = require('./collectionNames');

const app = express();
app.use(express.json());

// Polyfill minimal browser globals before loading cheerio/undici
if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File {};
}
if (typeof globalThis.Blob === 'undefined') {
    // Node 18 has Blob in buffer; use it if available
    try {
        const { Blob } = require('buffer');
        globalThis.Blob = globalThis.Blob || Blob;
    } catch (e) {
        globalThis.Blob = class Blob {};
    }
}
if (typeof globalThis.FormData === 'undefined') {
    globalThis.FormData = globalThis.FormData || class FormData {};
}

// fetch + HTML parsing for song images
// prefer global fetch (Node 18+), fallback to dynamic import of node-fetch only if needed
const cheerio = require('cheerio');
const fetch = (typeof globalThis.fetch === 'function')
    ? globalThis.fetch.bind(globalThis)
    : (...args) => import('node-fetch').then(({ default: f }) => f(...args));
// Puppeteer fallback for pages that render results client-side
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    try { puppeteer = require('puppeteer-core'); } catch (e2) { puppeteer = null; }
}

// MongoDB connection – reuse a single client to avoid slow new connection per request
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/';
const DB_NAME = 'mydatabase';

let mongoClient = null;

async function getDatabase() {
    if (mongoClient) {
        return mongoClient.db(DB_NAME);
    }
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    return mongoClient.db(DB_NAME);
}

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
        const db = await getDatabase();
        const id = username === 'ryan' ? 'ryan' : username; // friendIdx from link (e.g. 6020500221031)
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ success: false, error: 'invalid user id' });
        }
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

        const db = await getDatabase();
        const id = username === 'ryan' ? 'ryan' : username;
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ error: 'invalid user id' });
        }
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
        const db = await getDatabase();
        const id = username === 'ryan' ? 'ryan' : username;
        const collectionName = getTopCollectionName(id);
        if (!collectionName) {
            return res.status(400).json({ error: 'invalid user id' });
        }
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
        const r = await fetch('https://maimai.sega.jp/data/maimai_songs.json');
        if (!r.ok) throw new Error(`SEGA API returned ${r.status}`);
        segaSongsCache = await r.json();
        segaSongsCacheTime = now;
        console.log(`[server] Cached ${segaSongsCache.length} songs from SEGA`);
        return segaSongsCache;
    } catch (err) {
        console.error('[server] Failed to fetch SEGA songs:', err);
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

        const r = await fetch(url);
        if (!r.ok) {
            return res.status(502).json({ error: `failed to fetch image (${r.status})` });
        }
        const arrayBuf = await r.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const mime = r.headers.get('content-type') || 'image/jpeg';
        const base64 = buf.toString('base64');
        const dataUrl = `data:${mime};base64,${base64}`;
        res.json({ image: dataUrl });
    } catch (err) {
        console.error('[server] /image-data error:', err);
        res.status(500).json({ error: String(err) });
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
        const r = await fetch(imageUrl);
        if (!r.ok) {
            return res.status(502).json({ error: `failed to fetch image (${r.status})` });
        }
        const arrayBuf = await r.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const mime = r.headers.get('content-type') || 'image/jpeg';
        const base64 = buf.toString('base64');
        const dataUrl = `data:${mime};base64,${base64}`;
        setCachedSongImageData(title, dataUrl);
        res.json({ image: dataUrl });
    } catch (err) {
        console.error('[server] /song-image-data error:', err);
        res.status(500).json({ error: String(err) });
    }
});

app.post('/run-update-user-data', async (req, res) => {
    try {
        console.log('[server] /run-update-user-data triggered');
        const ok = await updateUserData();
        res.json({ success: !!ok });
    } catch (err) {
        console.error('[server] update-user-data error', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

app.post('/run-update-score', async (req, res) => {
    try {
        console.log('[server] /run-update-score triggered');
        if (typeof updateScore.runStandalone === 'function') {
            const messages = await updateScore.runStandalone();
            res.json({ success: true, messages });
        } else if (typeof updateScore.execute === 'function') {
            const outputs = [];
            const fakeChannel = { send: (p) => { outputs.push(p); return Promise.resolve(); } };
            await updateScore.execute(fakeChannel);
            res.json({ success: true, messages: outputs });
        } else {
            res.status(500).json({ success: false, error: 'update_score has no runnable export' });
        }
    } catch (err) {
        console.error('[server] update-score error', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

app.post('/run-friends-webhook', async (req, res) => {
    try {
        console.log('[server] /run-friends-webhook triggered');
        let friendsWebhook = null;
        try {
            friendsWebhook = require('../Discord_Bot/scripts/friends_webhook');
        } catch (e) {
            res.status(500).json({ success: false, error: `failed to load friends_webhook: ${String(e)}` });
            return;
        }
        if (friendsWebhook && typeof friendsWebhook.run === 'function') {
            await friendsWebhook.run();
            res.json({ success: true });
            return;
        }
        res.status(500).json({ success: false, error: 'friends_webhook has no runnable export' });
    } catch (err) {
        console.error('[server] friends-webhook error', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

const port = process.env.EXPRESS_PORT || 3000;
app.listen(port, () => {
    console.log(`[server] Express server listening on port ${port}`);
});

module.exports = app;
