/**
 * Schedules daily run of update_user_data (Puppeteer).
 * RUN_AT env = "HH:MM" (24h), default "22:45" → cron "45 22 * * *"
 * Set SCRAPER_CRON_ENABLED=false to disable scheduling (manual run only via Discord /scraper or npm run run-scraper).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const cron = require('node-cron');
const { updateUserData } = require('./update_user_data');

const cronEnabled = process.env.SCRAPER_CRON_ENABLED !== 'false';
const RUN_AT = (process.env.RUN_AT || '22:45').trim();
const [hour, minute] = RUN_AT.split(':').map((s) => s.padStart(2, '0'));
const cronExpr = `${minute} ${hour} * * *`;

if (cronEnabled) {
  console.log(`[cron] User-data scraper scheduled daily at ${RUN_AT} (cron: ${cronExpr})`);
  cron.schedule(cronExpr, async () => {
    console.log('[cron] Running scheduled user-data update');
    try {
      const ok = await updateUserData();
      console.log('[cron] User-data update finished:', ok ? 'success' : 'no success');
    } catch (err) {
      console.error('[cron] User-data update error:', err);
    }
  });
} else {
  console.log('[cron] SCRAPER_CRON_ENABLED=false — no schedule; use Discord /scraper or npm run run-scraper for manual run.');
}

// Keep process alive
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
