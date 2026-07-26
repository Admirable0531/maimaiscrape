const { EmbedBuilder } = require('discord.js');
const config = require('../Discord_Bot/config');
const { getDb } = require('../Discord_Bot/lib/mongo');
const { getTopCollectionName, getFriendIdxFromOldName } = require('./collectionNames');

const SONG_DB_URL = 'https://arcade-songs.zetaraku.dev/maimai/';
const MAX_FIELDS_PER_EMBED = 25;
/** How many recent snapshots to scan when looking for one from an earlier day. */
const SNAPSHOT_SCAN_LIMIT = 30;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatDDMM(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

/** Calendar day (YYYY-MM-DD, UTC) of a document, from the timestamp inside its ObjectId. */
function getCalendarDay(id) {
    if (!id || typeof id.getTimestamp !== 'function') return '';
    const d = id.getTimestamp();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Compare loosely: the scrapers store ratings as both strings and numbers over time. */
function normalizeRating(rating) {
    if (rating == null) return null;
    const str = String(rating).trim();
    const num = parseFloat(str);
    return Number.isNaN(num) ? str : num;
}

function normalizeAchv(achv) {
    return achv == null ? null : String(achv).trim();
}

function sameChart(a, b) {
    return a.Song === b.Song && a.Diff === b.Diff && a.Chart === b.Chart;
}

/** Entries in `current` that are new, or whose rating/achievement moved. */
function findImprovedEntries(current, previous) {
    const previousList = Array.isArray(previous) ? previous : [];
    return (Array.isArray(current) ? current : []).filter((entry) => {
        const before = previousList.find((item) => sameChart(item, entry));
        if (!before) return true;
        return (
            normalizeRating(entry.Rating) !== normalizeRating(before.Rating) ||
            normalizeAchv(entry.Achv) !== normalizeAchv(before.Achv)
        );
    });
}

function formatScoreLine(song, tag) {
    const songLink = `${SONG_DB_URL}?title=${encodeURIComponent(song.Song)}&types=${encodeURIComponent(
        String(song.Chart || '').toLowerCase()
    )}`;
    return (
        `${song.Rank} | ${song.Rating}rt | [${song.Song}](${songLink}) ` +
        `[${String(song.Diff || '').toUpperCase()}] (${song.Chart}) | ${song.Level} | ${song.Achv} | ${tag}`
    );
}

/**
 * Resolves the set of user ids to report on ('ryan' plus friendIdx strings),
 * taken from user_info so we only ever read ryan_top / friend_<idx>_top.
 */
async function loadUserIds(db) {
    try {
        const docs = await db.collection('user_info').find({}).sort({ _id: -1 }).toArray();
        const ids = [];
        const seen = new Set();

        for (const doc of docs) {
            const friendIdx = doc.friendIdx != null ? String(doc.friendIdx) : null;
            const userVal = doc.user != null ? String(doc.user) : null;

            let id = null;
            if (userVal === 'ryan') id = 'ryan';
            else if (friendIdx && /^\d+$/.test(friendIdx)) id = friendIdx;
            else if (userVal && /^\d+$/.test(userVal)) id = userVal;
            else if (userVal && config.idxMap?.[userVal]) id = config.idxMap[userVal];
            else if (userVal && getFriendIdxFromOldName(userVal)) id = getFriendIdxFromOldName(userVal);

            if (id && !seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
        if (ids.length > 0) return ids;
        console.warn('[update_score] user_info yielded no ids; falling back to config.users');
    } catch (err) {
        console.error('[update_score] failed to load users from user_info:', err.message);
    }
    return config.users || [];
}

function resolveUserId(user) {
    if (user === 'ryan') return 'ryan';
    return config.idxMap?.[user] || getFriendIdxFromOldName(user) || user;
}

/** Latest snapshot plus the newest one from an earlier calendar day. */
async function loadSnapshotPair(db, collectionName) {
    const documents = await db
        .collection(collectionName)
        .find()
        .sort({ _id: -1 })
        .limit(SNAPSHOT_SCAN_LIMIT)
        .toArray();

    const current = documents[0];
    if (!current) {
        console.error(`[update_score] ${collectionName}: no data`);
        return null;
    }

    const currentDay = getCalendarDay(current._id);
    const previous = documents.slice(1).find((doc) => getCalendarDay(doc._id) !== currentDay);
    if (!previous) {
        console.error(`[update_score] ${collectionName}: no snapshot from an earlier day to compare`);
        return null;
    }
    return { current, previous };
}

async function getUserInfo(db, userId) {
    try {
        const doc = await db.collection('user_info').findOne({ user: String(userId) }, { sort: { _id: -1 } });
        if (!doc) {
            console.error('[update_score] no user_info for', userId);
            return { imgSrc: null, name: String(userId), rating: '' };
        }
        return { imgSrc: doc.img_src ?? null, name: doc.name ?? String(userId), rating: doc.rating ?? '' };
    } catch (err) {
        console.error('[update_score] getUserInfo failed:', err.message);
        return { imgSrc: null, name: String(userId), rating: '' };
    }
}

/** Builds the per-user embeds. Returns [] when there is nothing worth posting. */
async function buildUserEmbeds(db, userId) {
    const collectionName = getTopCollectionName(userId);
    if (!collectionName) {
        console.error('[update_score] unknown user:', userId);
        return [];
    }

    const pair = await loadSnapshotPair(db, collectionName);
    if (!pair) return [];

    const { current, previous } = pair;
    const ratingDiff = (current.rating ?? 0) - (previous.rating ?? 0);
    const ratingDiffStr = `(${ratingDiff >= 0 ? '+' : '-'}${Math.abs(ratingDiff)}rt)`;

    const lines = [
        ...findImprovedEntries(current.new, previous.new).map((song) => formatScoreLine(song, 'NEW')),
        ...findImprovedEntries(current.old, previous.old).map((song) => formatScoreLine(song, 'OLD')),
    ];

    const { imgSrc, name, rating } = await getUserInfo(db, userId);
    const author = { name: `${name} ${rating}rt ${ratingDiffStr}`, iconURL: imgSrc || undefined };

    if (lines.length === 0) {
        // Always show Ryan so the daily post is never completely empty.
        if (userId !== 'ryan') return [];
        return [
            new EmbedBuilder()
                .setColor(0x7289da)
                .setAuthor(author)
                .addFields({ name: ' ', value: 'No individual top song changes today.' }),
        ];
    }

    const embeds = [];
    for (let i = 0; i < lines.length; i += MAX_FIELDS_PER_EMBED) {
        const embed = new EmbedBuilder().setColor(0x7289da).setAuthor(author);
        for (const line of lines.slice(i, i + MAX_FIELDS_PER_EMBED)) {
            embed.addFields({ name: ' ', value: line });
        }
        embeds.push(embed);
    }
    return embeds;
}

/**
 * Posts the daily score diff for every tracked user to `channel`.
 *
 * Every send is awaited. Previously `compareSongs()` was called without `await`,
 * so `execute()` resolved before the embeds were built — which made
 * `runStandalone()` return a partial (often empty) message list, and the daily
 * 23:00 post silently dropped users.
 */
async function execute(channel) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dateEmbed = new EmbedBuilder().setColor(0x0099ff).setAuthor({
        name: `${formatDDMM(yesterday)} -> ${formatDDMM(today)}`,
        iconURL: 'https://maimai.sega.jp/storage/area/region/universe/icon/03.png',
    });
    await channel.send({ embeds: [dateEmbed] });

    const db = await getDb();
    const users = await loadUserIds(db);
    console.log(`[update_score] reporting on ${users.length} user(s)`);

    for (const user of users) {
        const userId = resolveUserId(user);
        try {
            const embeds = await buildUserEmbeds(db, userId);
            for (const embed of embeds) {
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error(`[update_score] failed for ${userId}:`, err.message);
        }
    }
}

/** Runs execute() against an in-memory channel and returns the collected payloads. */
async function runStandalone() {
    const outputs = [];
    const fakeChannel = {
        async send(payload) {
            try {
                if (payload && Array.isArray(payload.embeds)) {
                    outputs.push({
                        embeds: payload.embeds.map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e)),
                    });
                } else {
                    outputs.push({
                        content: payload?.content ? payload.content : JSON.stringify(payload),
                    });
                }
            } catch {
                outputs.push({ error: 'failed to serialize payload' });
            }
        },
    };

    await execute(fakeChannel);
    return outputs;
}

module.exports = { execute, runStandalone };
