const { MongoClient } = require('mongodb');
const config = require('../config');

/**
 * Single shared MongoClient for the whole process.
 *
 * Replaces the previous pattern where circle_ranking_scraper.js opened (and
 * closed) three separate clients per run, each retrying the same three URIs.
 * The driver already pools connections, so one client per process is correct.
 */
let clientPromise = null;

const SELECTION_TIMEOUT_MS = parseInt(process.env.MONGO_SELECTION_TIMEOUT_MS || '2000', 10);

/**
 * Connection candidates, most likely first.
 *
 * The localhost fallbacks exist only so scripts can be run outside Docker, where
 * the `mongodb` hostname doesn't resolve. They're skipped when MONGO_URI points
 * somewhere specific — otherwise every failed connection burned one full
 * selection timeout per candidate before reporting the real error.
 */
function candidateUris() {
    const primary = config.MONGO_URI;
    let host = null;
    try {
        host = new URL(primary).hostname;
    } catch {
        // Non-standard URI (e.g. a replica-set list); use it as-is.
    }

    const needsLocalFallback = !primary || host === 'mongodb';
    const uris = needsLocalFallback
        ? [primary, 'mongodb://127.0.0.1:27017/mydatabase']
        : [primary];

    return [...new Set(uris.filter(Boolean))];
}

async function connect() {
    const errors = [];
    for (const uri of candidateUris()) {
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: SELECTION_TIMEOUT_MS });
        try {
            await client.connect();
            await client.db(config.DB_NAME).command({ ping: 1 });
            console.log(`[mongo] connected to ${uri}`);
            return client;
        } catch (err) {
            errors.push(`${uri}: ${err.message}`);
            await client.close().catch(() => {});
        }
    }
    throw new Error(`could not connect to MongoDB. Tried:\n  ${errors.join('\n  ')}`);
}

/** Returns the shared Db, connecting on first use. */
async function getDb() {
    if (!clientPromise) {
        clientPromise = connect().catch((err) => {
            // Don't cache a failed connection, so the next call retries.
            clientPromise = null;
            throw err;
        });
    }
    const client = await clientPromise;
    return client.db(config.DB_NAME);
}

/** Closes the shared client. Only needed by one-shot CLI scripts before exit. */
async function closeMongo() {
    if (!clientPromise) return;
    const pending = clientPromise;
    clientPromise = null;
    try {
        const client = await pending;
        await client.close();
    } catch {
        // already failed to connect; nothing to close
    }
}

module.exports = { getDb, closeMongo };
