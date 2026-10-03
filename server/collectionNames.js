/**
 * Single source of truth for MongoDB top-score collection names.
 * - Main user (Ryan): ryan_top
 * - Friends: friend_<friendIdx>_top where friendIdx is the ID from the link
 *   (e.g. from href ...?friendIdx=6020500221031 or form input name="idx" value="6020500221031")
 *
 * userId can be: 'ryan' (string) or friendIdx string (e.g. '6020500221031')
 */
function getTopCollectionName(userId) {
    if (userId === 'ryan' || userId === undefined) return 'ryan_top';
    const id = typeof userId === 'string' ? userId : String(userId);
    if (!/^\d+$/.test(id)) return null;
    return `friend_${id}_top`;
}

/**
 * Nickname -> friendIdx from the friend link.
 *
 * The one place this mapping lives. discord-bot/config.js re-exports it as
 * `idxMap`, which is what /constant resolves nicknames through, and the
 * migration script walks it to find old `<nickname>_top` collections. It
 * used to be spelled out in both files with *different contents* — this copy
 * had five entries and config.js's had seven — so `klcc` and `jerry`
 * resolved for /constant but were invisible to anything reading this file.
 */
const NAME_TO_FRIEND_IDX = {
    klcc: '4039890368767',
    yuchen: '6020500221031',
    marcus: '8071982688053',
    kok: '8085423055111',
    yuan: '8070962675681',
    keyang: '8091021494559',
    jerry: '6028368715803',
};

function getFriendIdxFromOldName(name) {
    return NAME_TO_FRIEND_IDX[name];
}

module.exports = {
    getTopCollectionName,
    getFriendIdxFromOldName,
    NAME_TO_FRIEND_IDX,
    // Kept under the old export name too: the migration script reads it as
    // "the names that predate friendIdx", which is the same mapping.
    OLD_NAME_TO_FRIEND_IDX: NAME_TO_FRIEND_IDX,
};
