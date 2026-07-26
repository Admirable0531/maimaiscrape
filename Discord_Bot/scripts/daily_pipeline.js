const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const friendsWebhook = require('./friends_webhook');
const updateFriendRatings = require('./update_friend_ratings');

const LABEL = 'daily';

const EXPRESS_URL = process.env.EXPRESS_URL || 'http://api:3000';
const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MINUTES || '45', 10) * 60 * 1000;

/**
 * The ordered daily run.
 *
 * Previously two schedules raced: the scraper container scraped at 22:45 and the
 * bot posted at 23:00, assuming the scrape finished inside 15 minutes. Nothing
 * scheduled the friend-list scrape at all, so the friend leaderboard compare
 * always failed for want of a snapshot. And every report was routed through one
 * channel, when in fact each report has its own destination:
 *
 *   scrape-top-scores        -> writes ryan_top / friend_<idx>_top / user_info
 *   scrape-friend-list-fy    -> writes friend_rating_daily_snapshots
 *   scrape-friend-list-main  -> writes friend_rating_daily_snapshots_main
 *   post-score-update        -> scoreChannel            (dailyScoreChannelID)
 *   post-fy-leaderboard      -> FRIEND_WEBHOOK_URL_FY    (webhook)
 *   post-main-leaderboard    -> mainLeaderboardChannel   (mainLeaderboardChannelID)
 *
 * Every step is awaited and isolated: one failure is reported but the
 * remaining steps still run, since they don't depend on each other's success.
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
        throw new Error(`${endpoint} returned ${response.status}${payload.error ? `: ${payload.error}` : ''}`);
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
 * Step — scrape top scores and profiles for Ryan and every friend.
 * Writes ryan_top / friend_<idx>_top / user_info.
 */
async function scrapeTopScores() {
    await callApi('/run-update-user-data');
    return 'top scores scraped';
}

/**
 * Step — scrape one account's friend list ratings snapshot.
 * accountType 'fy' writes friend_rating_daily_snapshots;
 * 'main' writes friend_rating_daily_snapshots_main.
 */
async function scrapeFriendList(accountType) {
    const result = await friendsWebhook.run({ sendWebhook: false, saveToMongo: true, accountType });
    if (!result.ok) throw new Error(result.error || `${accountType} friend list scrape failed`);
    return `${result.friendsCount} friend ratings saved (${accountType})`;
}

/** Step — post the per-user score diff versus the previous day, to scoreChannel. */
async function postScoreUpdate(scoreChannel) {
    const { messages = [] } = await callApi('/run-update-score', { timeoutMs: 5 * 60 * 1000 });
    await postMessages(scoreChannel, messages);
    return `${messages.length} score message(s) posted`;
}

/** Step — post the FY friend rating leaderboard to its dedicated webhook. */
async function postFyLeaderboard() {
    if (!config.FRIEND_WEBHOOK_URL_FY) {
        return 'skipped (FRIEND_WEBHOOK_URL_FY not set)';
    }
    const result = await updateFriendRatings.execute({
        webhookUrl: config.FRIEND_WEBHOOK_URL_FY,
        accountType: 'fy',
    });
    if (!result.ok) throw new Error(result.reason || 'FY leaderboard failed');
    return `leaderboard posted for ${result.friendsCount} friends`;
}

/** Step — post the main-account friend rating leaderboard to its channel. */
async function postMainLeaderboard(mainLeaderboardChannel) {
    if (!mainLeaderboardChannel) {
        return 'skipped (MAIN_LEADERBOARD_CHANNEL_ID not set)';
    }
    const result = await updateFriendRatings.execute({ channel: mainLeaderboardChannel, accountType: 'main' });
    if (!result.ok) throw new Error(result.reason || 'main leaderboard failed');
    return `leaderboard posted for ${result.friendsCount} friends`;
}

/**
 * Runs the daily steps in order.
 *
 * `scoreChannel` is required (the score-diff post always needs somewhere to
 * go). `mainLeaderboardChannel` is optional — until MAIN_LEADERBOARD_CHANNEL_ID
 * is configured, that step logs as skipped rather than failing every night.
 */
async function run({ scoreChannel, mainLeaderboardChannel = null, steps: only } = {}) {
    if (!scoreChannel) throw new Error('daily pipeline requires a scoreChannel');

    const steps = [
        { name: 'scrape-top-scores', run: () => scrapeTopScores() },
        { name: 'scrape-friend-list-fy', run: () => scrapeFriendList('fy') },
        { name: 'scrape-friend-list-main', run: () => scrapeFriendList('main') },
        { name: 'post-score-update', run: () => postScoreUpdate(scoreChannel) },
        { name: 'post-fy-leaderboard', run: () => postFyLeaderboard() },
        { name: 'post-main-leaderboard', run: () => postMainLeaderboard(mainLeaderboardChannel) },
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
                results.map((r) => `${r.ok ? '✅' : '❌'} \`${r.name}\` — ${r.detail} _(${r.seconds}s)_`).join('\n')
            )
            .setFooter({ text: `Total ${totalSeconds}s • ${new Date().toLocaleString()}` });
        // The summary always goes to scoreChannel: it's the one destination
        // guaranteed to exist, and every failure is relevant context there
        // regardless of which report it was for.
        await scoreChannel.send({ embeds: [embed] }).catch((err) => {
            console.error(`[${LABEL}] could not post failure summary:`, err.message);
        });
    }

    return { ok: failures.length === 0, results, totalSeconds };
}

module.exports = { run };
