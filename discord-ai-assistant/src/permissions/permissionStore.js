const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'permissions.json');

/**
 * Flat JSON file for Phase 1 — this is auth data, not conversation history,
 * so unlike historyStore it must survive restarts even before Phase 2's
 * SQLite lands. OWNER_USER_ID (env) is always allowed and isn't stored here;
 * everyone else the owner grants access to goes in allowedUserIds.
 */
function loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.allowedUserIds)) return { allowedUserIds: [] };
        return parsed;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error('permissions', `Failed to read ${STORE_PATH}, starting empty`, err);
        }
        return { allowedUserIds: [] };
    }
}

function saveStore(store) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

let store = loadStore();

function getOwnerId() {
    return process.env.OWNER_USER_ID;
}

function isOwner(userId) {
    return userId === getOwnerId();
}

function isAllowed(userId) {
    return isOwner(userId) || store.allowedUserIds.includes(userId);
}

/** Returns true if the user was newly added, false if they already had access. */
function allowUser(userId) {
    if (store.allowedUserIds.includes(userId)) return false;
    store.allowedUserIds.push(userId);
    saveStore(store);
    return true;
}

/** Returns true if the user was removed, false if they didn't have access. */
function revokeUser(userId) {
    const before = store.allowedUserIds.length;
    store.allowedUserIds = store.allowedUserIds.filter((id) => id !== userId);
    if (store.allowedUserIds.length === before) return false;
    saveStore(store);
    return true;
}

function listAllowedUsers() {
    return [getOwnerId(), ...store.allowedUserIds];
}

module.exports = { isAllowed, isOwner, allowUser, revokeUser, listAllowedUsers, getOwnerId };
