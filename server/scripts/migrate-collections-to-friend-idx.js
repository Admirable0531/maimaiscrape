#!/usr/bin/env node
/**
 * Migrate old name-based data to the friendIdx-from-link naming.
 *
 *   1) Top collections: yuchen_top -> friend_6020500221031_top, ...
 *   2) user_info: user 'yuchen' -> '6020500221031' (and set friendIdx)
 *
 * Run `server/scripts/db-audit.js` first to see what is actually there.
 *
 *   docker compose exec api node server/scripts/migrate-collections-to-friend-idx.js --dry-run
 *   docker compose exec api node server/scripts/migrate-collections-to-friend-idx.js
 *
 * When running on your HOST (not in Docker): .env has MONGO_URI=mongodb://mongodb:27017/
 * which only resolves inside Docker. Use:
 *   MONGO_URI=mongodb://localhost:27017/ node server/scripts/migrate-collections-to-friend-idx.js
 * Or set MONGO_URI_LOCAL=mongodb://localhost:27017/ in .env to override when running locally.
 *
 * Safe to run more than once. Documents are copied by _id and ones already
 * present in the target are skipped, so a second run reports "already there"
 * instead of duplicating history — the previous version used a bare
 * insertMany(), which silently doubled every friend's score history (and so
 * their rating graph) each time someone re-ran it.
 */
const path = require('path');
try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
    // dotenv is optional — in Docker the env is already populated
}
const { MongoClient } = require('mongodb');
const { OLD_NAME_TO_FRIEND_IDX, getTopCollectionName } = require('../collectionNames');

// MONGO_URI_LOCAL overrides for running on the host (mongodb:27017 only resolves inside Docker)
const MONGO_URI =
    process.env.MONGO_URI_LOCAL || process.env.MONGO_URI || 'mongodb://localhost:27017/';
// DB_NAME, not MONGO_DB: discord-bot/config.js (and so the API, the bot and
// every scraper) reads DB_NAME. This script used to read MONGO_DB, so on any
// deployment that had renamed the database it migrated a 'mydatabase' that
// nothing else was using, and reported success having moved nothing.
const DB_NAME = process.env.DB_NAME || 'mydatabase';

const DRY_RUN = process.argv.includes('--dry-run');

/** Copies documents the target doesn't already hold (matched on _id). */
async function copyMissingDocs(oldCol, newCol) {
    const docs = await oldCol.find({}).toArray();
    if (docs.length === 0) return { total: 0, copied: 0, skipped: 0 };

    const existingIds = new Set(
        (
            await newCol
                .find({ _id: { $in: docs.map((d) => d._id) } }, { projection: { _id: 1 } })
                .toArray()
        ).map((d) => String(d._id))
    );
    const missing = docs.filter((doc) => !existingIds.has(String(doc._id)));

    if (missing.length > 0 && !DRY_RUN) {
        await newCol.insertMany(missing, { ordered: false });
    }
    return { total: docs.length, copied: missing.length, skipped: docs.length - missing.length };
}

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log(
        `[migrate] database ${DB_NAME}${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`
    );

    const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

    // 1) Copy old *_top collections into friend_<idx>_top
    for (const [oldName, friendIdx] of Object.entries(OLD_NAME_TO_FRIEND_IDX)) {
        const oldColName = `${oldName}_top`;
        const newColName = getTopCollectionName(friendIdx);

        if (!existing.has(oldColName)) {
            console.log(`[migrate] ${oldColName} does not exist, skipping`);
            continue;
        }

        const { total, copied, skipped } = await copyMissingDocs(
            db.collection(oldColName),
            db.collection(newColName)
        );
        if (total === 0) {
            console.log(`[migrate] ${oldColName} is empty, skipping`);
            continue;
        }
        console.log(
            `[migrate] ${oldColName} -> ${newColName} (friendIdx ${friendIdx}): ` +
                `${copied} copied, ${skipped} already there (of ${total})`
        );
    }

    // Any other *_top collection with no mapping is flagged rather than
    // ignored: a friend added under the old scheme but missing from
    // OLD_NAME_TO_FRIEND_IDX would otherwise be left behind silently.
    const unmapped = [...existing].filter(
        (name) =>
            name.endsWith('_top') &&
            !name.startsWith('friend_') &&
            name !== 'ryan_top' &&
            !OLD_NAME_TO_FRIEND_IDX[name.replace(/_top$/, '')]
    );
    for (const name of unmapped) {
        console.warn(
            `[migrate] WARNING: ${name} has no entry in collectionNames.OLD_NAME_TO_FRIEND_IDX ` +
                `— add its friendIdx there and re-run, or it stays unmigrated`
        );
    }

    // 2) Update user_info: old names -> friendIdx identity
    const userInfoCol = db.collection('user_info');
    for (const [oldName, friendIdx] of Object.entries(OLD_NAME_TO_FRIEND_IDX)) {
        const pending = await userInfoCol.countDocuments({ user: oldName });
        if (pending === 0) continue;

        if (DRY_RUN) {
            console.log(
                `[migrate] user_info: would update ${pending} doc(s) ${oldName} -> '${friendIdx}'`
            );
            continue;
        }
        const result = await userInfoCol.updateMany(
            { user: oldName },
            { $set: { user: String(friendIdx), friendIdx } }
        );
        console.log(
            `[migrate] user_info: ${oldName} -> user '${friendIdx}': ${result.modifiedCount} updated`
        );
    }

    const leftoverNames = await userInfoCol.distinct('user', {
        user: { $nin: ['ryan'], $not: { $regex: '^\\d+$' } },
    });
    if (leftoverNames.length > 0) {
        console.warn(
            `[migrate] WARNING: user_info still has non-numeric identities: ${leftoverNames.join(', ')} ` +
                `— /users/:id/top-score answers 400 for these, so the AI bot sees no scores for them`
        );
    }

    await client.close();
    console.log(
        DRY_RUN
            ? '[migrate] dry run done. Re-run without --dry-run to apply.'
            : '[migrate] done. Old *_top collections were left in place; drop them manually once you have ' +
                  'confirmed the new ones read correctly (db-audit.js shows both side by side).'
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
