#!/usr/bin/env node
/**
 * Read-only inventory of what's actually in Mongo, so the old -> new
 * migration can be decided from facts instead of guesses.
 *
 * Nothing here writes, drops or renames anything — it is safe to run against
 * production at any time.
 *
 *   docker compose exec api node server/scripts/db-audit.js
 *   # or, from the host:
 *   MONGO_URI=mongodb://localhost:27017/ node server/scripts/db-audit.js
 *
 * What it answers:
 *  - which top-score collections exist under the OLD name-based scheme
 *    (yuchen_top) versus the NEW link-based one (friend_6020500221031_top),
 *    and whether the old ones still hold documents the new ones don't
 *  - whether user_info still carries old-name identities ('yuchen'), which is
 *    what makes /users/:id/top-score answer 400 for that friend and the AI
 *    bot's get_maimai_friend_top_scores come back empty
 *  - how fresh each friend-rating snapshot collection and circle_rankings is
 */
const path = require('path');
try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
    // dotenv is optional — in Docker the env is already populated
}
const { MongoClient } = require('mongodb');
const { OLD_NAME_TO_FRIEND_IDX, getTopCollectionName } = require('../collectionNames');

const MONGO_URI =
    process.env.MONGO_URI_LOCAL || process.env.MONGO_URI || 'mongodb://localhost:27017/';
// Must match discord-bot/config.js (DB_NAME), which is what every runtime
// reader uses — an audit pointed at a different database would be worthless.
const DB_NAME = process.env.DB_NAME || 'mydatabase';

/** Newest document in a collection, by _id (ObjectId order is insertion order here). */
async function newestDoc(db, name, projection) {
    return db.collection(name).findOne({}, { sort: { _id: -1 }, projection });
}

function ageInDays(date) {
    if (!date) return null;
    return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log(
        `\n=== database: ${DB_NAME} (${MONGO_URI.replace(/\/\/.*@/, '//<redacted>@')}) ===`
    );

    const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
    const counts = new Map();
    for (const name of collections) {
        counts.set(name, await db.collection(name).countDocuments());
    }

    // ---- top-score collections, old scheme vs new ----
    console.log('\n--- top-score collections ---');
    const oldTopCollections = collections.filter(
        (name) => name.endsWith('_top') && !name.startsWith('friend_') && name !== 'ryan_top'
    );
    const newTopCollections = collections.filter((name) => name.startsWith('friend_'));

    console.log(`ryan_top: ${counts.get('ryan_top') ?? '(missing)'} docs`);
    for (const name of newTopCollections) {
        console.log(`  [new] ${name}: ${counts.get(name)} docs`);
    }
    if (oldTopCollections.length === 0) {
        console.log('  [old] none — nothing left under the name-based scheme');
    }
    for (const name of oldTopCollections) {
        const friendIdx = OLD_NAME_TO_FRIEND_IDX[name.replace(/_top$/, '')];
        const target = friendIdx ? getTopCollectionName(friendIdx) : null;
        const targetCount = target ? (counts.get(target) ?? 0) : null;
        const mapping = target
            ? `-> ${target} (${targetCount} docs there now)`
            : '-> NO MAPPING in collectionNames.OLD_NAME_TO_FRIEND_IDX';
        console.log(`  [old] ${name}: ${counts.get(name)} docs ${mapping}`);
    }

    // ---- user_info identity mix ----
    console.log('\n--- user_info identities (newest doc per identity) ---');
    const userInfo = await db.collection('user_info').find({}).sort({ _id: -1 }).toArray();
    const seen = new Map();
    for (const doc of userInfo) {
        const id = doc.user != null ? String(doc.user) : (doc.friendIdx ?? '(no user field)');
        if (!seen.has(id)) seen.set(id, { doc, count: 0 });
        seen.get(id).count += 1;
    }
    console.log(`total user_info docs: ${userInfo.length}, distinct identities: ${seen.size}`);
    for (const [id, { doc, count }] of seen) {
        const scheme =
            id === 'ryan'
                ? 'main-user'
                : /^\d+$/.test(id)
                  ? 'NEW (friendIdx)'
                  : 'OLD (name) — breaks /users/:id/top-score';
        const topCollection = getTopCollectionName(id === 'ryan' ? 'ryan' : id);
        const topDocs = topCollection ? (counts.get(topCollection) ?? 0) : 0;
        console.log(
            `  ${id.padEnd(16)} ${scheme.padEnd(38)} name="${doc.name ?? ''}" ` +
                `docs=${count} top_collection=${topCollection ?? 'n/a'} (${topDocs} docs)`
        );
    }

    // ---- snapshot freshness ----
    console.log('\n--- snapshots ---');
    for (const name of ['friend_rating_daily_snapshots', 'friend_rating_daily_snapshots_main']) {
        if (!collections.includes(name)) {
            console.log(`  ${name}: MISSING`);
            continue;
        }
        const latest = await db
            .collection(name)
            .findOne(
                {},
                { sort: { snapshotDate: -1 }, projection: { snapshotDate: 1, friends: 1 } }
            );
        const friendCount = Array.isArray(latest?.friends) ? latest.friends.length : 'n/a';
        console.log(
            `  ${name}: ${counts.get(name)} docs, newest snapshotDate=${latest?.snapshotDate ?? 'none'} (${friendCount} friends)`
        );
    }

    if (collections.includes('circle_rankings')) {
        const latest = await newestDoc(db, 'circle_rankings', { snapshotDate: 1, scrapedAt: 1 });
        const dates = await db.collection('circle_rankings').distinct('snapshotDate');
        console.log(
            `  circle_rankings: ${counts.get('circle_rankings')} docs across ${dates.length} day(s) ` +
                `(${dates.sort().join(', ') || 'none'}), newest scrapedAt=${latest?.scrapedAt ?? 'none'} ` +
                `(${ageInDays(latest?.scrapedAt) ?? '?'}d old)`
        );
    } else {
        console.log('  circle_rankings: MISSING');
    }

    // ---- anything unaccounted for ----
    const known = new Set([
        'ryan_top',
        'user_info',
        'friend_rating_daily_snapshots',
        'friend_rating_daily_snapshots_main',
        'circle_rankings',
        ...newTopCollections,
        ...oldTopCollections,
    ]);
    const other = collections.filter((name) => !known.has(name));
    if (other.length > 0) {
        console.log('\n--- other collections ---');
        for (const name of other) console.log(`  ${name}: ${counts.get(name)} docs`);
    }

    await client.close();
    console.log('');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
