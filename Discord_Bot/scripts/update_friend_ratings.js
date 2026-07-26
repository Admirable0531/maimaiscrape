const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const https = require('https');

function getCalendarDayUTC(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseRatingToNumber(ratingText) {
    if (!ratingText) return null;
    const m = String(ratingText).match(/(\d+(\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function formatSignedInt(n) {
    if (n == null) return '0';
    const v = Math.trunc(n);
    return (v >= 0 ? '+' : '') + String(v);
}

function safeName(name) {
    if (!name) return '(unknown)';
    return String(name).trim();
}

function snapshotDayToDDMM(dayStr) {
    // dayStr: YYYY-MM-DD
    const m = String(dayStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dayStr;
    return `${m[3]}/${m[2]}`;
}

function formatRatingRt(ratingNum) {
    if (ratingNum == null || !Number.isFinite(ratingNum)) return 'N/A';
    const v = Math.trunc(ratingNum);
    return `${v}rt`;
}

function buildLeaderboardEmbeds({ fromDay, toDay, todaySorted, yRank, yRating }) {
    const title = `${snapshotDayToDDMM(fromDay)} -> ${snapshotDayToDDMM(toDay)}`;

    const lines = todaySorted.map((f, i) => {
        const rankTo = i + 1;
        const name = safeName(f.name);
        const ratingTo = f.ratingNum;

        const rankFrom = yRank.get(String(f.friendIdx));
        const ratingFrom = yRating.get(String(f.friendIdx));

        let ratingDelta = null;
        let rankDelta = null;
        if (rankFrom != null && ratingFrom != null) {
            ratingDelta = ratingTo - ratingFrom;
            rankDelta = rankFrom - rankTo; // positive => moved up
        }

        const deltaStr = ratingDelta == null ? '(+0rt)' : `(${formatSignedInt(ratingDelta)}rt)`;
        const safeRankDelta = rankDelta == null ? 0 : rankDelta;
        const rankSteps = Math.abs(safeRankDelta);
        const placementSuffix =
            safeRankDelta === 0 ? '' : `${safeRankDelta > 0 ? '⬆️' : '⬇️'} ${rankSteps}`;

        return `\`${rankTo.toString().padStart(2, '0')}.\` **${name}** — ${formatRatingRt(ratingTo)} ${deltaStr}${
            placementSuffix ? ` ${placementSuffix}` : ''
        }`;
    });

    const MAX_CHARS = 4000;
    const chunks = [];
    let current = [];
    let currentLen = 0;

    for (const line of lines) {
        if (currentLen + line.length + 1 > MAX_CHARS && current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    }
    if (current.length > 0) chunks.push(current.join('\n'));

    return chunks.map((desc) => new EmbedBuilder().setTitle(title).setColor(0x7289da).setDescription(desc));
}

function sendToWebhook(webhookUrl, embeds) {
    if (!webhookUrl) return Promise.resolve(false);
    const payload = JSON.stringify({ embeds: embeds.map((e) => e.toJSON()) });
    const url = new URL(webhookUrl);
    const options = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
                else {
                    // eslint-disable-next-line no-console
                    console.error('[friendsrating][webhook] status', res.statusCode, data);
                    resolve(false);
                }
            });
        });
        req.on('error', (err) => {
            // eslint-disable-next-line no-console
            console.error('[friendsrating][webhook] error', err);
            resolve(false);
        });
        req.write(payload);
        req.end();
    });
}

async function execute(options = {}) {
    const channel = options.channel || null;
    const webhookUrl = options.webhookUrl || '';
    const accountType = options.accountType === 'main' ? 'main' : 'fy';

    const uri = config.MONGO_URI;
    const dbName = 'mydatabase';
    const colName =
        accountType === 'main'
            ? 'friend_rating_daily_snapshots_main'
            : 'friend_rating_daily_snapshots';

    const now = new Date();
    const todayDay = getCalendarDayUTC(now);
    const yDay = new Date(now);
    yDay.setUTCDate(yDay.getUTCDate() - 1);
    const yesterdayDay = getCalendarDayUTC(yDay);

    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db(dbName);
        const col = db.collection(colName);

        const [yDoc, tDoc] = await Promise.all([
            col.findOne({ snapshotDate: yesterdayDay }),
            col.findOne({ snapshotDate: todayDay }),
        ]);

        if (!tDoc || !yDoc) {
            const msg = `No friend rating snapshots to compare for ${yesterdayDay} -> ${todayDay}. (yesterday=${!!yDoc}, today=${!!tDoc})`;
            if (channel) await channel.send(msg);
            if (webhookUrl) {
                const embed = new EmbedBuilder().setTitle('Friend rating comparison').setColor(0xff0000).setDescription(msg);
                await sendToWebhook(webhookUrl, [embed]);
            }
            return { ok: false, reason: 'missing snapshots' };
        }

        const yFriends = Array.isArray(yDoc.friends) ? yDoc.friends : [];
        const tFriends = Array.isArray(tDoc.friends) ? tDoc.friends : [];

        if (yFriends.length === 0 || tFriends.length === 0) {
            const msg = `Friend ratings are empty for ${yesterdayDay} -> ${todayDay}.`;
            if (channel) await channel.send(msg);
            if (webhookUrl) {
                const embed = new EmbedBuilder().setTitle('Friend rating comparison').setColor(0xff0000).setDescription(msg);
                await sendToWebhook(webhookUrl, [embed]);
            }
            return { ok: false, reason: 'empty friends' };
        }

        const ySorted = yFriends
            .map((d) => ({
                friendIdx: d.friendIdx,
                name: d.name,
                ratingNum: d.rating != null ? d.rating : parseRatingToNumber(d.ratingText),
            }))
            .filter((d) => d.friendIdx && d.ratingNum != null)
            .sort((a, b) => b.ratingNum - a.ratingNum);

        const tSorted = tFriends
            .map((d) => ({
                friendIdx: d.friendIdx,
                name: d.name,
                ratingNum: d.rating != null ? d.rating : parseRatingToNumber(d.ratingText),
            }))
            .filter((d) => d.friendIdx && d.ratingNum != null)
            .sort((a, b) => b.ratingNum - a.ratingNum);

        const yRank = new Map(); // friendIdx -> rank
        const yRating = new Map(); // friendIdx -> ratingNum
        ySorted.forEach((d, i) => {
            yRank.set(String(d.friendIdx), i + 1);
            yRating.set(String(d.friendIdx), d.ratingNum);
        });

        const tRank = new Map();
        const tRating = new Map();
        tSorted.forEach((d, i) => {
            tRank.set(String(d.friendIdx), i + 1);
            tRating.set(String(d.friendIdx), d.ratingNum);
        });

        const embeds = buildLeaderboardEmbeds({
            fromDay: yesterdayDay,
            toDay: todayDay,
            todaySorted: tSorted,
            yRank,
            yRating,
        });

        if (channel) {
            await channel.send({ embeds });
        }
        if (webhookUrl) {
            await sendToWebhook(webhookUrl, embeds);
        }
        return { ok: true, friendsCount: tSorted.length };
    } finally {
        await client.close().catch(() => {});
    }
}

module.exports = {
    execute,
};

