const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../lib/mongo');
const { sendToWebhook } = require('../lib/webhook');
const {
    snapshotDayToDDMM,
    parseRatingToNumber,
    safeName,
    formatRatingRt,
    chunkLines,
} = require('../lib/format');

const LABEL = 'latestleaderboard';

function getSnapshotCollectionName(accountType) {
    return accountType === 'main' ? 'friend_rating_daily_snapshots_main' : 'friend_rating_daily_snapshots';
}

/** Posts the newest stored friend leaderboard with no comparison arrows. */
async function executeLatest(options = {}) {
    const channel = options.channel || null;
    const webhookUrl = options.webhookUrl || '';
    const accountType = options.accountType === 'main' ? 'main' : 'fy';

    const db = await getDb();
    const col = db.collection(getSnapshotCollectionName(accountType));

    const latest = await col.findOne({}, { sort: { snapshotDate: -1 } });
    if (!latest) {
        const msg = 'No friend rating snapshot found in MongoDB yet.';
        if (channel) await channel.send(msg);
        if (webhookUrl) {
            const embed = new EmbedBuilder()
                .setTitle('Latest friend leaderboard')
                .setColor(0xff0000)
                .setDescription(msg);
            await sendToWebhook(webhookUrl, [embed], LABEL);
        }
        return { ok: false, reason: 'no snapshot' };
    }

    const sorted = (Array.isArray(latest.friends) ? latest.friends : [])
        .map((f) => ({
            friendIdx: f.friendIdx,
            name: f.name,
            ratingNum: f.rating != null ? parseRatingToNumber(f.rating) : parseRatingToNumber(f.ratingText),
        }))
        .filter((f) => f.friendIdx && f.ratingNum != null)
        .sort((a, b) => b.ratingNum - a.ratingNum);

    const title = snapshotDayToDDMM(latest.snapshotDate);
    const lines = sorted.map((f, i) => {
        const rank = String(i + 1).padStart(2, '0');
        return `\`${rank}.\` **${safeName(f.name)}** — ${formatRatingRt(f.ratingNum)}`;
    });

    const embeds = chunkLines(lines, 4000).map((desc) =>
        new EmbedBuilder().setTitle(title).setColor(0x7289da).setDescription(desc)
    );

    if (channel) await channel.send({ embeds });
    if (webhookUrl) await sendToWebhook(webhookUrl, embeds, LABEL);

    return { ok: true, friendsCount: sorted.length };
}

module.exports = { executeLatest };
