const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'permissions.json');

/**
 * The tool categories access can be scoped to (see toolDefinitions.js's
 * TOOL_SCOPES for which tool needs which). Fixed and small on purpose —
 * per-individual-tool scoping would be finer-grained but harder for an
 * owner to reason about when granting access ("web" vs "read_webpage vs
 * search_web vs list_maimai_fandom_wiki_pages vs...").
 */
const VALID_SCOPES = ['web', 'account', 'leaderboard', 'memory'];

/**
 * Flat JSON file for Phase 1 — this is auth data, not conversation history,
 * so unlike historyStore it must survive restarts even before Phase 2's
 * SQLite lands. OWNER_USER_ID (env) is always allowed and isn't stored here.
 *
 * Two independent grant lists: allowedUserIds is full access (every scope,
 * same as the original behavior), scopedUserIds maps a userId to the
 * specific scopes they're limited to. A user is in at most one of these at
 * a time — granting scoped access to someone with full access downgrades
 * them (see allowUser), since "full but also limited" isn't meaningful.
 */
function loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            allowedUserIds: Array.isArray(parsed.allowedUserIds) ? parsed.allowedUserIds : [],
            scopedUserIds:
                parsed.scopedUserIds && typeof parsed.scopedUserIds === 'object' && !Array.isArray(parsed.scopedUserIds)
                    ? parsed.scopedUserIds
                    : {},
        };
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error('permissions', `Failed to read ${STORE_PATH}, starting empty`, err);
        }
        return { allowedUserIds: [], scopedUserIds: {} };
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
    return isOwner(userId) || store.allowedUserIds.includes(userId) || Boolean(store.scopedUserIds[userId]);
}

/**
 * 'all' for the owner or a fully-allowed user, an array of granted scope
 * names for a scoped user, or [] for no access at all. Callers gating a
 * specific tool should treat 'all' as "every scope granted" rather than
 * comparing arrays.
 */
function getAllowedScopes(userId) {
    if (isOwner(userId) || store.allowedUserIds.includes(userId)) return 'all';
    return store.scopedUserIds[userId] || [];
}

/**
 * Grants access. `scopes` omitted/null grants full access (original
 * behavior); a non-empty array grants only those scopes and downgrades any
 * existing full access. Returns true if this is a new grant, false if it
 * only updated an existing one (still applied either way).
 */
function allowUser(userId, scopes = null) {
    if (scopes === null) {
        const isNew = !store.allowedUserIds.includes(userId);
        delete store.scopedUserIds[userId]; // full access supersedes any prior scoped grant
        if (isNew) store.allowedUserIds.push(userId);
        saveStore(store);
        return isNew;
    }

    const isNew = !store.scopedUserIds[userId] && !store.allowedUserIds.includes(userId);
    store.allowedUserIds = store.allowedUserIds.filter((id) => id !== userId); // scoping down replaces full access
    store.scopedUserIds[userId] = scopes;
    saveStore(store);
    return isNew;
}

/** Returns true if the user was removed (from either list), false if they didn't have access. */
function revokeUser(userId) {
    const had = store.allowedUserIds.includes(userId) || Boolean(store.scopedUserIds[userId]);
    store.allowedUserIds = store.allowedUserIds.filter((id) => id !== userId);
    delete store.scopedUserIds[userId];
    if (had) saveStore(store);
    return had;
}

/** { full: userId[], scoped: {id, scopes}[] } — owner always included in full. */
function listAllowedUsers() {
    return {
        full: [getOwnerId(), ...store.allowedUserIds],
        scoped: Object.entries(store.scopedUserIds).map(([id, scopes]) => ({ id, scopes })),
    };
}

module.exports = {
    isAllowed,
    isOwner,
    allowUser,
    revokeUser,
    listAllowedUsers,
    getAllowedScopes,
    getOwnerId,
    VALID_SCOPES,
};
