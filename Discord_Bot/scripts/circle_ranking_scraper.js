const config = require('../config');
const { getDb, closeMongo } = require('../lib/mongo');
const { sendToWebhook } = require('../lib/webhook');
const { withMaimaiSession } = require('../lib/maimai_session');
const { getCalendarDayUTC, chunkLines } = require('../lib/format');

const LABEL = 'circle';
const CIRCLE_RANKING_URL = 'https://maimaidx-eng.com/maimai-mobile/circle/circleRanking/';
const COLLECTION = 'circle_rankings';
const RETENTION_DAYS = 7;

/**
 * True only when the page is genuinely a maintenance notice.
 *
 * The previous check was `content.includes('maintenance')` over the whole HTML,
 * which matched any footer link or help text containing the word and silently
 * aborted a healthy scrape. Now the ranking table's absence is required too.
 */
async function isMaintenancePage(page) {
    const result = await page.evaluate(() => {
        const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
        return {
            hasRankingBlock: !!document.querySelector('.ranking_top_block, .ranking_block'),
            mentionsMaintenance:
                bodyText.includes('under maintenance') ||
                bodyText.includes('now under maintenance') ||
                bodyText.includes('メンテナンス'),
        };
    });
    const title = ((await page.title()) || '').toLowerCase();
    const isMaintenance =
        !result.hasRankingBlock && (result.mentionsMaintenance || title.includes('maintenance'));

    if (isMaintenance) {
        console.log(`[${LABEL}][maintenance] detected`, JSON.stringify({ ...result, title, url: page.url() }));
    }
    return isMaintenance;
}

/** Scrapes the top-100 circle ranking table. */
async function scrapeCircleRankingPage(page, shot) {
    try {
        console.log(`[${LABEL}] navigating to circle ranking page`);
        await page.goto(CIRCLE_RANKING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await shot(page, '07_circle_ranking_page');

        if (await isMaintenancePage(page)) {
            return { maintenance: true, rankings: [] };
        }

        await page.waitForSelector('.ranking_top_block, .ranking_block', { timeout: 30000 });

        const rankings = await page.evaluate(() => {
            const entries = [
                ...Array.from(document.querySelectorAll('.ranking_top_block.f_0')).map((block) => ({
                    block,
                    type: 'top',
                })),
                ...Array.from(document.querySelectorAll('.ranking_block.f_0')).map((block) => ({
                    block,
                    type: 'regular',
                })),
            ];

            const results = [];
            entries.forEach(({ block, type }, index) => {
                const inner =
                    type === 'top'
                        ? block.querySelector('.ranking_top_inner_block')
                        : block.querySelector('.ranking_inner_block');
                if (!inner) return;

                const nameEl = inner.querySelector('.f_l.p_t_10.p_l_10.f_15');
                const groupName = nameEl ? nameEl.textContent.trim() : '';

                const pointsEl = inner.querySelector('.p_t_10.p_r_10.f_r.f_14');
                const pointsText = pointsEl ? pointsEl.textContent.trim() : '';
                const pointsMatch = pointsText.replace(/,/g, '').match(/(\d+)/);
                const points = pointsMatch ? parseInt(pointsMatch[1], 10) : null;

                // Document order is the ranking order; keep it as the source of truth.
                if (groupName && points != null) {
                    results.push({ rank: index + 1, groupName, points, pointsText });
                }
            });
            return results;
        });

        console.log(`[${LABEL}] scraped ${rankings.length} circle rankings`);
        return { maintenance: false, error: false, rankings };
    } catch (err) {
        console.error(`[${LABEL}] error scraping circle ranking page:`, err.message);
        return { error: true, rankings: [] };
    }
}

/** Ranking order: points descending, group name as tiebreak. Does not mutate the input. */
function sortRankings(rankings) {
    return [...rankings].sort((a, b) =>
        b.points !== a.points ? b.points - a.points : a.groupName.localeCompare(b.groupName)
    );
}

function toRankMap(rankings) {
    const map = new Map();
    sortRankings(rankings).forEach((r, index) => {
        map.set(r.groupName, { rank: index + 1, points: r.points });
    });
    return map;
}

/**
 * The most recent stored snapshot, i.e. the previous run.
 *
 * Must be called before saving the current scrape. The previous version took
 * `snapshots[1]` here, which — because it also ran pre-save — compared against
 * two runs ago and reported stale deltas.
 */
async function getPreviousCircleRankings() {
    try {
        const db = await getDb();
        const latest = await db.collection(COLLECTION).findOne({}, { sort: { scrapedAt: -1 } });
        return latest ? latest.rankings : null;
    } catch (err) {
        console.log(`[${LABEL}][prev] could not read previous rankings:`, err.message);
        return null;
    }
}

async function isFirstUpdateOfDay() {
    try {
        const db = await getDb();
        const count = await db.collection(COLLECTION).countDocuments({ snapshotDate: getCalendarDayUTC() });
        return count === 0;
    } catch (err) {
        console.log(`[${LABEL}][daily] could not check today's updates:`, err.message);
        return false;
    }
}

async function saveCircleRankingSnapshot(rankings) {
    if (!rankings || rankings.length === 0) return false;
    try {
        const db = await getDb();
        const col = db.collection(COLLECTION);
        const now = new Date();

        const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await col.deleteMany({ scrapedAt: { $lt: cutoff } });

        await col.insertOne({
            snapshotDate: getCalendarDayUTC(now),
            rankings: sortRankings(rankings).map((r, index) => ({
                rank: index + 1,
                groupName: r.groupName,
                points: r.points,
                pointsText: r.pointsText,
            })),
            scrapedAt: now,
            timestamp: now.getTime(),
        });

        console.log(`[${LABEL}][save] saved ${rankings.length} rankings for ${getCalendarDayUTC(now)}`);
        return true;
    } catch (err) {
        console.error(`[${LABEL}][save] error saving to MongoDB:`, err.message);
        return false;
    }
}

/** Any points or placement movement versus the previous snapshot. */
function hasSignificantChanges(currentRankings, previousRankings) {
    if (!previousRankings || previousRankings.length === 0) return true;
    if (currentRankings.length !== previousRankings.length) return true;

    const current = toRankMap(currentRankings);
    const previous = toRankMap(previousRankings);
    let changes = 0;

    for (const [groupName, now] of current) {
        const before = previous.get(groupName);
        if (!before) changes++;
        else if (now.points !== before.points || now.rank !== before.rank) changes++;
    }
    for (const groupName of previous.keys()) {
        if (!current.has(groupName)) changes++;
    }

    console.log(`[${LABEL}][changes] ${changes} change(s) vs previous snapshot`);
    return changes > 0;
}

function buildCircleRankingEmbeds(rankings, previousRankings = null, isFirstOfDay = false) {
    if (!rankings || rankings.length === 0) {
        return [
            {
                title: 'Circle Rankings - Top 100',
                description: 'No circle rankings found or failed to scrape.',
                color: 0xff0000,
            },
        ];
    }

    const sorted = sortRankings(rankings);
    const previous = previousRankings && previousRankings.length > 0 ? toRankMap(previousRankings) : null;

    const lines = sorted.map((r, index) => {
        const currentRank = index + 1;
        const rankStr = String(currentRank).padStart(2, '0');

        let changeIndicator = ' 🆕';
        let pointsChangeIndicator = '';

        const before = previous && previous.get(r.groupName);
        if (before) {
            const rankChange = before.rank - currentRank;
            const pointsChange = r.points - before.points;

            if (rankChange > 0) changeIndicator = ` ⬆️${rankChange}`;
            else if (rankChange < 0) changeIndicator = ` ⬇️${Math.abs(rankChange)}`;
            else changeIndicator = ' ➖';

            if (pointsChange !== 0) {
                const sign = pointsChange > 0 ? '+' : '';
                pointsChangeIndicator = ` (${sign}${pointsChange.toLocaleString()})`;
            }
        } else if (!previous) {
            changeIndicator = '';
        }

        return `\`${rankStr}.\` **${r.groupName}** — ${r.points.toLocaleString()} PT${pointsChangeIndicator}${changeIndicator}`;
    });

    const chunks = chunkLines(lines, 3000, 30);
    const comparisonText = previous ? ' • ⬆️⬇️ vs last update' : '';
    const now = new Date();

    const divider = isFirstOfDay ? '═'.repeat(48) : '─'.repeat(48);
    const dividerText = isFirstOfDay
        ? '🌅 **DAILY CIRCLE RANKINGS UPDATE** 🌅\n📊 **Complete Top 100 Circle Rankings** 📊'
        : '⏰ **CIRCLE RANKINGS UPDATE** ⏰';

    console.log(`[${LABEL}][embeds] ${chunks.length} embed(s) for ${sorted.length} rankings`);

    return chunks.map((desc, idx) => ({
        title: idx === 0 ? 'Circle Rankings - Top 100' : `Circle Rankings (cont. ${idx + 1})`,
        description: idx === 0 ? `${divider}\n${dividerText}\n${divider}\n\n${desc}` : desc,
        color: isFirstOfDay ? 0xffd700 : 0x7289da,
        footer: { text: `Total: ${sorted.length} circles • Updated: ${now.toLocaleString()}${comparisonText}` },
    }));
}

/**
 * @param {object} opts
 * @param {true|false|'auto'} [opts.sendWebhook] true = always post, 'auto' = only
 *   when something changed, false = never post. Previously an explicit `false`
 *   was ignored and the webhook still fired whenever changes were detected,
 *   so `/circle webhook:none` posted anyway.
 * @param {boolean} [opts.saveToMongo=true]
 */
async function run(opts = {}) {
    const webhookMode = opts.sendWebhook ?? 'auto';
    const doSave = opts.saveToMongo ?? true;
    const webhookUrl = config.CIRCLE_WEBHOOK_URL;
    const credentials = {
        sid: config.MAIMAI_ACCOUNT_RATING_FY || '',
        password: config.MAIMAI_PASSWORD_RATING || '',
    };

    if (!credentials.sid || !credentials.password) {
        console.error(
            `[${LABEL}] missing credentials. Set MAIMAI_ACCOUNT_RATING_FY and MAIMAI_PASSWORD_RATING in .env.`
        );
        return { ok: false, error: 'missing credentials', rankingsCount: 0 };
    }

    console.log(`[${LABEL}] starting circle ranking scrape (webhook: ${webhookMode}, save: ${doSave})`);

    try {
        const result = await withMaimaiSession({
            credentials,
            label: LABEL,
            fallback: { error: true, rankings: [] },
            task: (page, _browser, { shot }) => scrapeCircleRankingPage(page, shot),
        });

        if (result.maintenance) {
            console.log(`[${LABEL}] maimai is in maintenance; skipping scrape`);
            if (webhookMode === true) {
                await sendToWebhook(
                    webhookUrl,
                    [
                        {
                            title: 'Circle Rankings - Maintenance',
                            description: 'maimai is currently under maintenance. Scraping will resume afterwards.',
                            color: 0xffa500,
                            footer: { text: `Checked at: ${new Date().toLocaleString()}` },
                        },
                    ],
                    LABEL
                );
            }
            return { ok: true, maintenance: true, rankingsCount: 0, sentWebhook: false };
        }

        if (result.error) {
            console.error(`[${LABEL}] scraping failed`);
            if (webhookMode === true) {
                await sendToWebhook(
                    webhookUrl,
                    [
                        {
                            title: 'Circle Rankings - Error',
                            description: 'Failed to scrape circle rankings (login issue or site change).',
                            color: 0xff0000,
                            footer: { text: `Error at: ${new Date().toLocaleString()}` },
                        },
                    ],
                    LABEL
                );
            }
            return { ok: false, error: 'scraping failed', rankingsCount: 0, sentWebhook: false };
        }

        const { rankings } = result;

        // Read comparison state before saving, so "previous" is the prior run.
        let previousRankings = null;
        let isFirstOfDay = false;
        if (rankings.length > 0) {
            previousRankings = await getPreviousCircleRankings();
            isFirstOfDay = await isFirstUpdateOfDay();
        }

        if (doSave) {
            await saveCircleRankingSnapshot(rankings);
        }

        const hasChanges = hasSignificantChanges(rankings, previousRankings);
        const shouldSend =
            rankings.length > 0 && (webhookMode === true || (webhookMode === 'auto' && hasChanges));

        let sentWebhook = false;
        if (shouldSend) {
            console.log(`[${LABEL}][webhook] posting (mode: ${webhookMode}, changes: ${hasChanges})`);
            sentWebhook = await sendToWebhook(
                webhookUrl,
                buildCircleRankingEmbeds(rankings, previousRankings, isFirstOfDay),
                LABEL
            );
        } else if (webhookMode === false) {
            console.log(`[${LABEL}][webhook] disabled for this run`);
        } else {
            console.log(`[${LABEL}][webhook] no changes detected; nothing posted`);
        }

        return { ok: true, rankingsCount: rankings.length, hasChanges, sentWebhook };
    } catch (err) {
        console.error(`[${LABEL}] error in circle ranking scraper:`, err);
        return { ok: false, error: String(err), rankingsCount: 0, sentWebhook: false };
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

module.exports = { run, buildCircleRankingEmbeds, hasSignificantChanges, sortRankings };
