const config = require('../config');
const { getDb, closeMongo } = require('../lib/mongo');
const { sendToWebhook } = require('../lib/webhook');
const { chunkLines } = require('../lib/format');

const LABEL = 'daily-points';
const COLLECTION = 'circle_rankings';

/**
 * Computes per-circle points gains for a day.
 *
 * With more than one snapshot for the day it measures first→last within the day.
 * With exactly one (the normal case now that the circle scraper runs once daily)
 * it measures the previous day's snapshot → that day's snapshot.
 *
 * `targetDate` defaults to the newest snapshotDate in the collection rather than
 * "UTC yesterday". The cron fires in MYT (UTC+8) while snapshotDate is a UTC day,
 * so a hardcoded yesterday skewed which day actually got reported.
 */
async function getDailyPointsGains(targetDate = null) {
    const db = await getDb();
    const collection = db.collection(COLLECTION);

    let dateToCheck = targetDate;
    if (!dateToCheck) {
        const newest = await collection.findOne({}, { sort: { scrapedAt: -1 }, projection: { snapshotDate: 1 } });
        if (!newest) {
            console.log(`[${LABEL}] no circle ranking snapshots stored yet`);
            return null;
        }
        dateToCheck = newest.snapshotDate;
    }

    console.log(`[${LABEL}] analyzing gains for ${dateToCheck}`);

    const daySnapshots = await collection.find({ snapshotDate: dateToCheck }).sort({ scrapedAt: 1 }).toArray();

    let firstSnapshot;
    let lastSnapshot;
    let totalSnapshots;

    if (daySnapshots.length >= 2) {
        firstSnapshot = daySnapshots[0];
        lastSnapshot = daySnapshots[daySnapshots.length - 1];
        totalSnapshots = daySnapshots.length;
        console.log(`[${LABEL}] comparing ${totalSnapshots} same-day snapshots`);
    } else if (daySnapshots.length === 1) {
        lastSnapshot = daySnapshots[0];
        const [previous] = await collection
            .find({ snapshotDate: { $lt: dateToCheck } })
            .sort({ scrapedAt: -1 })
            .limit(1)
            .toArray();
        if (!previous) {
            console.log(`[${LABEL}] only one snapshot for ${dateToCheck} and no prior day to compare`);
            return null;
        }
        firstSnapshot = previous;
        totalSnapshots = 2;
        console.log(`[${LABEL}] comparing prior day ${firstSnapshot.snapshotDate} → ${dateToCheck}`);
    } else {
        console.log(`[${LABEL}] no snapshots for ${dateToCheck}`);
        return null;
    }

    const firstMap = new Map(firstSnapshot.rankings.map((r) => [r.groupName, r.points]));
    const lastMap = new Map(lastSnapshot.rankings.map((r) => [r.groupName, r.points]));

    const pointsGains = [];

    for (const [groupName, lastPoints] of lastMap) {
        const firstPoints = firstMap.get(groupName);
        if (firstPoints === undefined) {
            pointsGains.push({
                groupName,
                startPoints: 0,
                endPoints: lastPoints,
                pointsGain: lastPoints,
                percentageGain: 0,
                isNew: true,
            });
        } else {
            const gain = lastPoints - firstPoints;
            pointsGains.push({
                groupName,
                startPoints: firstPoints,
                endPoints: lastPoints,
                pointsGain: gain,
                percentageGain: firstPoints > 0 ? (gain / firstPoints) * 100 : 0,
            });
        }
    }

    // A circle that dropped out of the top 100 isn't necessarily at zero points,
    // so flag it rather than reporting a full-value loss.
    for (const [groupName, firstPoints] of firstMap) {
        if (!lastMap.has(groupName)) {
            pointsGains.push({
                groupName,
                startPoints: firstPoints,
                endPoints: null,
                pointsGain: 0,
                percentageGain: 0,
                droppedOut: true,
            });
        }
    }

    pointsGains.sort((a, b) => b.pointsGain - a.pointsGain);

    return {
        date: dateToCheck,
        firstSnapshot: { time: firstSnapshot.scrapedAt, totalTeams: firstSnapshot.rankings.length },
        lastSnapshot: { time: lastSnapshot.scrapedAt, totalTeams: lastSnapshot.rankings.length },
        totalSnapshots,
        pointsGains,
    };
}

function formatTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function buildDailyPointsEmbed(data) {
    if (!data || !data.pointsGains || data.pointsGains.length === 0) {
        return [
            {
                title: '📈 Daily Points Gains',
                description: 'No data available for daily points calculation.',
                color: 0xff0000,
            },
        ];
    }

    const { date, firstSnapshot, lastSnapshot, totalSnapshots, pointsGains } = data;

    const gainers = pointsGains.filter((g) => g.pointsGain > 0);
    const topGainers = gainers.slice(0, 20);
    const noChange = pointsGains.filter((g) => g.pointsGain === 0 && !g.droppedOut).length;
    const droppedOut = pointsGains.filter((g) => g.droppedOut);
    const decreases = pointsGains.filter((g) => g.pointsGain < 0);
    const totalGains = gainers.reduce((sum, g) => sum + g.pointsGain, 0);

    const divider = '═'.repeat(48);
    const lines = [
        `${divider}\n📈 **DAILY POINTS GAINS REPORT** 📈\n📊 **Top Performers & Biggest Movers** 📊\n${divider}\n`,
        `**📅 Date:** ${date}`,
        `**⏰ Period:** ${formatTime(firstSnapshot.time)} → ${formatTime(lastSnapshot.time)}`,
        `**📊 Snapshots:** ${totalSnapshots} updates tracked`,
        `**📈 Total Points Gained:** ${totalGains.toLocaleString()} PT`,
        `**🏆 Teams with Gains:** ${gainers.length}`,
        `**➖ No Change:** ${noChange} teams`,
    ];

    if (droppedOut.length > 0) lines.push(`**👻 Dropped out of top 100:** ${droppedOut.length} teams`);
    if (decreases.length > 0) lines.push(`**⚠️ Unusual Decreases:** ${decreases.length} teams`);
    lines.push('');

    if (topGainers.length > 0) {
        lines.push('**🏆 TOP GAINERS OF THE DAY**');
        topGainers.forEach((team, index) => {
            const rank = String(index + 1).padStart(2, '0');
            const percent = team.percentageGain > 0 ? ` (+${team.percentageGain.toFixed(1)}%)` : '';
            const newTag = team.isNew ? ' 🆕' : '';
            lines.push(
                `\`${rank}.\` **${team.groupName}** — +${team.pointsGain.toLocaleString()} PT${percent}${newTag}`
            );
        });
        lines.push('');
    }

    if (decreases.length > 0) {
        lines.push('**⚠️ UNUSUAL POINT DECREASES** (may indicate a data issue)');
        decreases.slice(0, 5).forEach((team, index) => {
            const rank = String(index + 1).padStart(2, '0');
            lines.push(`\`${rank}.\` **${team.groupName}** — ${team.pointsGain.toLocaleString()} PT`);
        });
        lines.push('');
    }

    if (droppedOut.length > 0) {
        lines.push('**👻 DROPPED OUT OF TOP 100**');
        droppedOut.slice(0, 5).forEach((team, index) => {
            const rank = String(index + 1).padStart(2, '0');
            lines.push(`\`${rank}.\` **${team.groupName}** — was ${team.startPoints.toLocaleString()} PT`);
        });
    }

    const footer = { text: `Generated: ${new Date().toLocaleString()} • Period: ${totalSnapshots} updates` };

    return chunkLines(lines, 4000).map((desc, idx) => ({
        title: idx === 0 ? '📈 Daily Points Gains Report' : `Daily Points Report (cont. ${idx + 1})`,
        description: desc,
        color: 0x00ff00,
        footer,
    }));
}

async function run(opts = {}) {
    const sendWebhook = opts.sendWebhook ?? true;
    const targetDate = opts.targetDate || null;
    const webhookUrl = config.CIRCLE_WEBHOOK_URL;

    console.log(`[${LABEL}] starting daily points gain analysis`);

    try {
        const data = await getDailyPointsGains(targetDate);

        if (!data) {
            if (sendWebhook) {
                await sendToWebhook(
                    webhookUrl,
                    [
                        {
                            title: '📈 Daily Points Gains - No Data',
                            description:
                                'Not enough circle ranking snapshots to compare yet. Need at least two scrapes.',
                            color: 0xffa500,
                            footer: { text: `Checked at: ${new Date().toLocaleString()}` },
                        },
                    ],
                    LABEL
                );
            }
            return { ok: false, error: 'insufficient data' };
        }

        if (sendWebhook) {
            await sendToWebhook(webhookUrl, buildDailyPointsEmbed(data), LABEL);
        }

        console.log(`[${LABEL}] analysis completed: ${data.pointsGains.length} teams analyzed`);
        return {
            ok: true,
            date: data.date,
            teamsAnalyzed: data.pointsGains.length,
            totalSnapshots: data.totalSnapshots,
        };
    } catch (err) {
        console.error(`[${LABEL}] error in daily points tracker:`, err);
        return { ok: false, error: String(err) };
    }
}

if (require.main === module) {
    run()
        .then((result) => {
            console.log(`[${LABEL}] completed:`, result);
            return closeMongo();
        })
        .then(() => process.exit(0))
        .catch(async (err) => {
            console.error(err);
            await closeMongo().catch(() => {});
            process.exit(1);
        });
}

module.exports = { run, getDailyPointsGains, buildDailyPointsEmbed };
