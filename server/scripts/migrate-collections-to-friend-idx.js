#!/usr/bin/env node
/**
 * Migrate old name-based data to friendIdx-from-link naming.
 * Run once from repo root: node server/scripts/migrate-collections-to-friend-idx.js
 *
 * 1) Top collections: yuchen_top -> friend_6020500221031_top, ...
 * 2) user_info: update user 'yuchen' -> '6020500221031' (and set friendIdx), etc.
 *
 * When running on your HOST (not in Docker): .env has MONGO_URI=mongodb://mongodb:27017/
 * which only works inside Docker. Use:
 *   MONGO_URI=mongodb://localhost:27017/ node server/scripts/migrate-collections-to-friend-idx.js
 * Or set MONGO_URI_LOCAL=mongodb://localhost:27017/ in .env to override when running locally.
 */
const path = require('path');
try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (e) {
    // dotenv optional if env vars already set (e.g. Docker)
}
const { MongoClient } = require('mongodb');
const { OLD_NAME_TO_FRIEND_IDX, getTopCollectionName } = require('../collectionNames');

// MONGO_URI_LOCAL overrides for running script on host (mongodb:27017 only resolves inside Docker)
const MONGO_URI = process.env.MONGO_URI_LOCAL || process.env.MONGO_URI || 'mongodb://localhost:27017/';
const DB_NAME = process.env.MONGO_DB || 'mydatabase';

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    // 1) Copy old *_top collections to friend_<idx>_top using correct friendIdx
    for (const [oldName, friendIdx] of Object.entries(OLD_NAME_TO_FRIEND_IDX)) {
        const oldColName = `${oldName}_top`;
        const newColName = getTopCollectionName(friendIdx); // friend_6020500221031_top, ...
        const oldCol = db.collection(oldColName);
        const newCol = db.collection(newColName);

        const count = await oldCol.countDocuments();
        if (count === 0) {
            console.log(`[migrate] ${oldColName} is empty, skipping`);
            continue;
        }

        const docs = await oldCol.find({}).toArray();
        if (docs.length > 0) {
            await newCol.insertMany(docs);
            console.log(`[migrate] ${oldColName} -> ${newColName} (friendIdx ${friendIdx}): ${docs.length} documents`);
        }
    }

    // 2) Update user_info: old names -> correct user (string idx) + friendIdx
    const userInfoCol = db.collection('user_info');
    for (const [oldName, friendIdx] of Object.entries(OLD_NAME_TO_FRIEND_IDX)) {
        const result = await userInfoCol.updateMany(
            { user: oldName },
            { $set: { user: String(friendIdx), friendIdx } }
        );
        if (result.modifiedCount > 0) {
            console.log(`[migrate] user_info: ${oldName} -> user '${friendIdx}' (friendIdx ${friendIdx}): ${result.modifiedCount} updated`);
        }
    }

    await client.close();
    console.log('[migrate] done. Old *_top collections were left in place; drop them manually if desired.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
