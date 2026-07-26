const { EmbedBuilder } = require('discord.js');
const friendsWebhook = require('./friends_webhook');
const updateFriendRatings = require('./update_friend_ratings');

const LABEL = 'daily';

const EXPRESS_URL = process.env.EXPRESS_URL || 'http://api:3000';
const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MINUTES || '45', 10) * 60 * 1000;

/**
 * The ordered daily run.
 *
 * Previously two schedules raced: the scraper container scraped at 22:45 and the
 * bot posted at 23:00, assuming the scrape finished inside 15 minutes. If it ran
 * long or failed, the bot posted stale data (or nothing) with no indication why.
 * Nothing scheduled the friend-list scrape at all, so the friend leaderboard
 * compare always failed for want of a snapshot.
 *
 * Now one scheduler runs the steps in sequence, each awaited, each failure
 * isolated and reported.
 */

/** POSTs to the express api, failing loudly rather than hanging forever. */
async function callApi(endpoint, { timeoutMs = SCRAPE_TIMEOUT_MS, body } = {}) {
    const response = await fetch(`${EXPRESS_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(
            `${endpoint} returned ${response.status}${payload.error ? `: ${payload.error}` : ''}`
        );
    }
    return payload;
}

/** Replays the payloads collected by update_score's fake channel into Discord. */
async function postMessages(channel, messages) {
    for (const message of messages) {
        if (message.embeds?.length) {
            await channel.send({ embeds: message.embeds.map((e) => new EmbedBuilder(e)) });
        } else if (message.content) {
            await channel.send(message.content);
        }
    }
}

/**
 * Step 1 — scrape top scores and profiles for Ryan and every friend.
 * Writes ryan_top / friend_<idx>_top / user_info.
 */
async function scrapeTopScores() {
    await callApi('/run-update-user-data');
    return 'top scores scraped';
}

/**
 * Step 2 — scrape the friend list ratings snapshot.
 * Writes one friend_rating_daily_snapshots document for today.
 */
async function scrapeFriendList() {
    const result = await friendsWebhook.run({ sendWebhook: false, saveToMongo: true, accountType: 'fy' });
    if (!result.ok) throw new Error(result.error || 'friend list scrape failed');
    return `${result.friendsCount} friend ratings saved`;
}

/** Step 3 — post the per-user score diff versus the previous day. */
async function postScoreUpdate(channel) {
    const { messages = [] } = await callApi('/run-update-score', { timeoutMs: 5 * 60 * 1000 });
    await postMessages(channel, messages);
    return `${messages.length} score message(s) posted`;
}

/** Step 4 — post the friend rating leaderboard with day-over-day movement. */
async function postFriendLeaderboard(channel) {
    const result = await updateFriendRatings.execute({ channel, webhookUrl: '' });
    if (!result.ok) throw new Error(result.reason || 'friend leaderboard failed');
    return `leaderboard posted for ${result.friendsCount} friends`;
}

/**
 * Runs the four steps in order.
 *
 * A failed step is recorded and the run continues, because the later steps are
 * still useful on their own — a failed friend-list scrape shouldn't suppress the
 * score post. The channel gets a summary only when something went wrong.
 */
async function run({ channel, steps: only } = {}) {
    if (!channel) throw new Error('daily pipeline requires a channel');

    const steps = [
        { name: 'scrape-top-scores', run: () => scrapeTopScores() },
        { name: 'scrape-friend-list', run: () => scrapeFriendList() },
        { name: 'post-score-update', run: () => postScoreUpdate(channel) },
        { name: 'post-friend-leaderboard', run: () => postFriendLeaderboard(channel) },
    ].filter((step) => !only || only.includes(step.name));

    const started = Date.now();
    const results = [];

    for (const step of steps) {
        const stepStarted = Date.now();
        try {
            console.log(`[${LABEL}] ${step.name}: starting`);
            const detail = await step.run();
            const seconds = Math.round((Date.now() - stepStarted) / 1000);
            console.log(`[${LABEL}] ${step.name}: ok (${seconds}s) — ${detail}`);
            results.push({ name: step.name, ok: true, detail, seconds });
        } catch (err) {
            const seconds = Math.round((Date.now() - stepStarted) / 1000);
            const message = err.name === 'TimeoutError' ? `timed out after ${seconds}s` : err.message;
            console.error(`[${LABEL}] ${step.name}: FAILED (${seconds}s) — ${message}`);
            results.push({ name: step.name, ok: false, detail: message, seconds });
        }
    }

    const failures = results.filter((r) => !r.ok);
    const totalSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`[${LABEL}] finished in ${totalSeconds}s — ${failures.length} failure(s)`);

    if (failures.length > 0) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ Daily update had problems')
            .setDescription(
                results
                    .map((r) => `${r.ok ? '✅' : '❌'} \`${r.name}\` — ${r.detail} _(${r.seconds}s)_`)
                    .join('\n')
            )
            .setFooter({ text: `Total ${totalSeconds}s • ${new Date().toLocaleString()}` });
        await channel.send({ embeds: [embed] }).catch((err) => {
            console.error(`[${LABEL}] could not post failure summary:`, err.message);
        });
    }

    return { ok: failures.length === 0, results, totalSeconds };
}

module.exports = { run };
