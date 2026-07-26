const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const https = require('https');

function parseRatingToNumber(rating) {
    if (rating == null) return null;
    if (typeof rating === 'number' && Number.isFinite(rating)) return rating;
    const m = String(rating).match(/(\d+(\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function snapshotDayToDDMM(dayStr) {
    const m = String(dayStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dayStr;
    return `${m[3]}/${m[2]}`;
}

function safeName(name) {
    if (!name) return '(unknown)';
    return String(name).trim();
}

function formatRatingRt(ratingNum) {
    if (ratingNum == null || !Number.isFinite(ratingNum)) return 'N/A';
    const v = Math.trunc(ratingNum);
    return `${v}rt`;
}

function chunkLines(lines, maxChars = 4000) {
    const chunks = [];
    let current = [];
    let currentLen = 0;
    for (const line of lines) {
        if (currentLen + line.length + 1 > maxChars && current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    }
    if (current.length > 0) chunks.push(current.join('\n'));
    return chunks;
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
                else resolve(false);
            });
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

async function executeLatest(options = {}) {
    const channel = options.channel || null;
    const webhookUrl = options.webhookUrl || '';
    const accountType = options.accountType === 'main' ? 'main' : 'fy';

    const uri = config.MONGO_URI;
    const dbName = 'mydatabase';
    const colName = accountType === 'main' ? 'friend_rating_daily_snapshots_main' : 'friend_rating_daily_snapshots';

    const client = new MongoClient(uri);
    await client.connect();

    try {
        const col = client.db(dbName).collection(colName);

        const latestDoc = await col.find({}).sort({ snapshotDate: -1 }).limit(1).toArray();
        const latest = latestDoc[0];
        if (!latest) {
            const msg = 'No friend rating snapshot found in MongoDB yet.';
            if (channel) await channel.send(msg);
            if (webhookUrl) {
                const embed = new EmbedBuilder().setTitle('Latest friend leaderboard').setColor(0xff0000).setDescription(msg);
                await sendToWebhook(webhookUrl, [embed]);
            }
            return { ok: false, reason: 'no snapshot' };
        }

        const snapshotDate = latest.snapshotDate;
        const friends = Array.isArray(latest.friends) ? latest.friends : [];

        const sorted = friends
            .map((f) => ({
                friendIdx: f.friendIdx,
                name: f.name,
                ratingNum: f.rating != null ? parseRatingToNumber(f.rating) : parseRatingToNumber(f.ratingText),
            }))
            .filter((d) => d.friendIdx && d.ratingNum != null)
            .sort((a, b) => b.ratingNum - a.ratingNum);

        const title = snapshotDayToDDMM(snapshotDate);
        const lines = sorted.map((f, i) => {
            const rank = i + 1;
            return `\`${rank.toString().padStart(2, '0')}.\` **${safeName(f.name)}** — ${formatRatingRt(f.ratingNum)}`;
        });

        const chunks = chunkLines(lines, 4000);
        const embeds = chunks.map((desc) => new EmbedBuilder().setTitle(title).setColor(0x7289da).setDescription(desc));

        if (channel) await channel.send({ embeds });
        if (webhookUrl) await sendToWebhook(webhookUrl, embeds);

        return { ok: true, friendsCount: sorted.length };
    } finally {
        await client.close().catch(() => {});
    }
}

module.exports = { executeLatest };

