const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * Non-secret configuration only.
 *
 * Every credential and webhook URL comes from the environment (.env, which is
 * gitignored). Nothing secret belongs in this file — it is committed to git.
 * See .env.example for the full list of variables.
 */

/** Secrets that must be present for the scrapers/reports to work. */
const REQUIRED_SECRETS = [
    'MAIMAI_ACCOUNT_RATING_FY',
    'MAIMAI_PASSWORD_RATING',
    'FRIEND_WEBHOOK_URL_FY',
    'CIRCLE_WEBHOOK_URL',
];

function env(name, fallback) {
    const value = process.env[name];
    return value != null && value !== '' ? value : fallback;
}

/**
 * Logs a single loud warning listing anything missing, so a misconfigured .env
 * shows up immediately in `docker compose logs` instead of as a silent
 * "login failed" much later.
 */
function warnOnMissingSecrets() {
    const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        console.warn(
            `[config] Missing required environment variables: ${missing.join(', ')}.\n` +
                `[config] Add them to .env (see .env.example). Scraping and webhook posts will fail until then.`
        );
    }
    return missing;
}

module.exports = {
    MONGO_URI: env('MONGO_URI', 'mongodb://mongodb:27017/mydatabase'),
    DB_NAME: env('DB_NAME', 'mydatabase'),

    // 'ryan' = main user (ryan_top); rest = friendIdx from link (friend_<id>_top)
    users: ['ryan', '6020500221031', '8071982688053', '8085423055111', '8070962675681', '8091021494559'],
    dailyScoreChannelID: env('DAILY_SCORE_CHANNEL_ID', '1233678655717118022'),
    // Main-account friend leaderboard has no webhook (unlike FY, which uses
    // FRIEND_WEBHOOK_URL_FY) — it posts via the bot client to this channel id,
    // the same way dailyScoreChannelID does. Empty until set in .env.
    mainLeaderboardChannelID: env('MAIN_LEADERBOARD_CHANNEL_ID', ''),
    checkConstant: ['klcc', 'marcus', 'yuan', 'keyang', 'yuchen', 'jerry', 'kok'],
    idxMap: {
        klcc: '4039890368767',
        yuchen: '6020500221031',
        marcus: '8071982688053',
        kok: '8085423055111',
        yuan: '8070962675681',
        keyang: '8091021494559',
        jerry: '6028368715803',
    },

    // ---- secrets: environment only, no fallbacks ----
    MAIMAI_ACCOUNT_RATING_FY: process.env.MAIMAI_ACCOUNT_RATING_FY || '',
    MAIMAI_ACCOUNT_RATING_MAIN: process.env.MAIMAI_ACCOUNT_RATING_MAIN || '',
    MAIMAI_PASSWORD_RATING: process.env.MAIMAI_PASSWORD_RATING || '',
    // Optional — only needed if the main account's SEGA password differs
    // from the fy account's. Falls back to MAIMAI_PASSWORD_RATING if unset.
    MAIMAI_PASSWORD_RATING_MAIN: process.env.MAIMAI_PASSWORD_RATING_MAIN || '',

    FRIEND_WEBHOOK_URL_FY: process.env.FRIEND_WEBHOOK_URL_FY || '',
    FRIEND_WEBHOOK_URL_TEST: process.env.FRIEND_WEBHOOK_URL_TEST || '',
    CIRCLE_WEBHOOK_URL: process.env.CIRCLE_WEBHOOK_URL || '',

    // Optional explicit browser path for Puppeteer (ARM / Raspberry Pi)
    CHROME_EXECUTABLE_PATH: process.env.CHROME_EXECUTABLE_PATH || undefined,

    warnOnMissingSecrets,
};
