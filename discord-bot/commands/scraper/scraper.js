const { SlashCommandBuilder } = require('discord.js');
const { longFetch } = require('../../lib/long_fetch');

const EXPRESS_URL = process.env.EXPRESS_URL || 'http://api:3000';
// A Discord interaction token is valid for 15 minutes, after which every
// editReply/followUp on it fails with "Unknown Webhook". This used to wait
// SCRAPE_TIMEOUT_MINUTES (45 by default), so a scrape that ran long — the
// normal case when a friend's page is slow — left the command showing
// "thinking..." forever and then threw an unhandled rejection into the logs
// instead of reporting anything. The HTTP wait is capped under the token's
// lifetime now: past this the scrape keeps going server-side (it holds
// runExclusive, so nothing can double-start it) and the reply says so.
const INTERACTION_BUDGET_MS = 14 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scraper')
        // What it actually does: /run-update-user-data, i.e. the daily
        // pipeline's `scrape-top-scores` step on its own — this account's and
        // every friend's top plays plus their profile rows. It does NOT take
        // a friend *rating* snapshot (that's /updatefriendsdata) and it posts
        // nothing to Discord (that's /update).
        .setDescription(
            'Scrape top scores + profiles now (no Discord posts) — the daily scrape on its own'
        ),

    async execute(interaction) {
        await interaction.deferReply();

        // editReply throws once the 15-minute token has expired; the scrape
        // itself already happened, so that must not surface as a failure.
        const report = async (content) => {
            try {
                await interaction.editReply(content);
            } catch (err) {
                console.warn('[scraper] could not edit the reply:', err.message);
            }
        };

        try {
            const resp = await longFetch(`${EXPRESS_URL}/run-update-user-data`, {
                method: 'POST',
                signal: AbortSignal.timeout(INTERACTION_BUDGET_MS),
            });
            const body = await resp.json().catch(() => ({}));

            if (resp.status === 409) {
                await report('A scrape is already running — try again once it finishes.');
            } else if (resp.ok && body.success) {
                await report(
                    'Scrape completed — `ryan_top`, `friend_<idx>_top` and `user_info` now hold a ' +
                        'fresh snapshot. Run `/update` to post the score diff.'
                );
            } else {
                await report(
                    `Scrape failed${body.error ? `: ${body.error}` : ' or returned no success.'} ` +
                        'The Puppeteer error is in `docker compose logs api`.'
                );
            }
        } catch (err) {
            console.error('[scraper] error triggering the scrape:', err);
            const reason =
                err.name === 'TimeoutError'
                    ? 'it was still running after 14 minutes — it may still finish; check `docker compose logs api`'
                    : `could not reach the api (${err.message})`;
            await report(`Could not confirm the scrape: ${reason}.`);
        }
    },
};
