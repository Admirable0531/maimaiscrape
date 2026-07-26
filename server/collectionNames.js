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

/** Old name -> friendIdx from the link (for migration only) */
const OLD_NAME_TO_FRIEND_IDX = {
    yuchen: '6020500221031',
    marcus: '8071982688053',
    kok: '8085423055111',
    yuan: '8070962675681',
    keyang: '8091021494559',
};

function getFriendIdxFromOldName(name) {
    return OLD_NAME_TO_FRIEND_IDX[name];
}

module.exports = {
    getTopCollectionName,
    getFriendIdxFromOldName,
    OLD_NAME_TO_FRIEND_IDX,
};
