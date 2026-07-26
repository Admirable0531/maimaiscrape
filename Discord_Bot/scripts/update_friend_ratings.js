const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../lib/mongo');
const { sendToWebhook } = require('../lib/webhook');
const {
    getCalendarDayUTC,
    snapshotDayToDDMM,
    parseRatingToNumber,
    safeName,
    formatRatingRt,
    formatSignedInt,
    chunkLines,
} = require('../lib/format');

const LABEL = 'friendsrating';

function getSnapshotCollectionName(accountType) {
    return accountType === 'main' ? 'friend_rating_daily_snapshots_main' : 'friend_rating_daily_snapshots';
}

/** Normalises a snapshot's friends array into sorted {friendIdx, name, ratingNum}. */
function toSortedFriends(friends) {
    return (Array.isArray(friends) ? friends : [])
        .map((f) => ({
            friendIdx: f.friendIdx,
            name: f.name,
            ratingNum: f.rating != null ? parseRatingToNumber(f.rating) : parseRatingToNumber(f.ratingText),
        }))
        .filter((f) => f.friendIdx && f.ratingNum != null)
        .sort((a, b) => b.ratingNum - a.ratingNum);
}

function buildLeaderboardEmbeds({ fromDay, toDay, todaySorted, previousByIdx }) {
    const title = fromDay ? `${snapshotDayToDDMM(fromDay)} -> ${snapshotDayToDDMM(toDay)}` : snapshotDayToDDMM(toDay);

    const lines = todaySorted.map((friend, index) => {
        const rankTo = index + 1;
        const before = previousByIdx.get(String(friend.friendIdx));

        let deltaStr = '';
        let placementSuffix = '';
        if (before) {
            const ratingDelta = friend.ratingNum - before.ratingNum;
            const rankDelta = before.rank - rankTo; // positive => moved up
            deltaStr = ` (${formatSignedInt(ratingDelta)}rt)`;
            if (rankDelta !== 0) {
                placementSuffix = ` ${rankDelta > 0 ? '⬆️' : '⬇️'} ${Math.abs(rankDelta)}`;
            }
        } else if (previousByIdx.size > 0) {
            placementSuffix = ' 🆕';
        }

        const rank = String(rankTo).padStart(2, '0');
        return `\`${rank}.\` **${safeName(friend.name)}** — ${formatRatingRt(friend.ratingNum)}${deltaStr}${placementSuffix}`;
    });

    return chunkLines(lines, 4000).map((desc) =>
        new EmbedBuilder().setTitle(title).setColor(0x7289da).setDescription(desc)
    );
}

async function report(target, embedsOrMessage) {
    const { channel, webhookUrl } = target;
    if (typeof embedsOrMessage === 'string') {
        if (channel) await channel.send(embedsOrMessage);
        if (webhookUrl) {
            const embed = new EmbedBuilder()
                .setTitle('Friend rating comparison')
                .setColor(0xff0000)
                .setDescription(embedsOrMessage);
            await sendToWebhook(webhookUrl, [embed], LABEL);
        }
        return;
    }
    if (channel) await channel.send({ embeds: embedsOrMessage });
    if (webhookUrl) await sendToWebhook(webhookUrl, embedsOrMessage, LABEL);
}

/**
 * Posts today's friend leaderboard with rating/placement deltas.
 *
 * The comparison baseline is the most recent snapshot *before* today, not
 * strictly yesterday: if the scrape missed a day, the previous version bailed
 * out with "no snapshots to compare" instead of reporting anything.
 */
async function execute(options = {}) {
    const channel = options.channel || null;
    const webhookUrl = options.webhookUrl || '';
    const accountType = options.accountType === 'main' ? 'main' : 'fy';
    const target = { channel, webhookUrl };

    const db = await getDb();
    const col = db.collection(getSnapshotCollectionName(accountType));

    const todayDay = getCalendarDayUTC();

    // Today's snapshot, or the newest one if today's scrape hasn't landed.
    const todayDoc =
        (await col.findOne({ snapshotDate: todayDay })) ||
        (await col.findOne({}, { sort: { snapshotDate: -1 } }));

    if (!todayDoc) {
        await report(target, 'No friend rating snapshots stored yet — run /updatefriendsdata first.');
        return { ok: false, reason: 'no snapshots' };
    }

    const toDay = todayDoc.snapshotDate;
    const previousDoc = await col.findOne({ snapshotDate: { $lt: toDay } }, { sort: { snapshotDate: -1 } });

    const todaySorted = toSortedFriends(todayDoc.friends);
    if (todaySorted.length === 0) {
        await report(target, `Friend ratings are empty for ${toDay}.`);
        return { ok: false, reason: 'empty friends' };
    }

    const previousByIdx = new Map();
    if (previousDoc) {
        toSortedFriends(previousDoc.friends).forEach((friend, index) => {
            previousByIdx.set(String(friend.friendIdx), { rank: index + 1, ratingNum: friend.ratingNum });
        });
    } else {
        console.log(`[${LABEL}] no earlier snapshot than ${toDay}; posting without deltas`);
    }

    const embeds = buildLeaderboardEmbeds({
        fromDay: previousDoc ? previousDoc.snapshotDate : null,
        toDay,
        todaySorted,
        previousByIdx,
    });

    await report(target, embeds);
    return { ok: true, friendsCount: todaySorted.length, comparedAgainst: previousDoc?.snapshotDate ?? null };
}

module.exports = { execute };
