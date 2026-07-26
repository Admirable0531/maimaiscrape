# 🎵 Maimai Top Play Scraper

Scrapes top plays, profiles, friend ratings and circle rankings from **maimai DX NET**,
stores them in MongoDB, and posts daily reports to Discord.

## 📦 What runs where

| Service   | Container      | Role |
|-----------|----------------|------|
| `bot`     | `discord_bot`  | Discord bot. Owns **all** schedules and handles slash commands. |
| `api`     | `express_api`  | HTTP API for the web UI, plus the Puppeteer jobs the bot triggers. |
| `mongodb` | `mongodb`      | Data store (`mydatabase`). |
| `web`     | `maimai_web`   | Vite front-end for browsing scores. |
| `scraper` | `puppeteer_scraper` | Manual-only profile; not started by `docker compose up`. |

## ⏰ Automation

One scheduler (the bot) runs everything in order, so scraping can never race posting.

**`DAILY_PIPELINE_AT` (default 22:45)** — the daily pipeline, six sequential steps,
each posting to its own destination:

| Step | Writes / posts to |
|------|--------------------|
| `scrape-top-scores` | POSTs `/run-update-user-data`; writes `ryan_top`, `friend_<idx>_top`, `user_info` |
| `scrape-friend-list-fy` | scrapes the FY account's friends; writes `friend_rating_daily_snapshots` |
| `scrape-friend-list-main` | scrapes the main account's friends; writes `friend_rating_daily_snapshots_main` |
| `post-score-update` | posts each user's new/improved charts vs the previous day, to **`DAILY_SCORE_CHANNEL_ID`** |
| `post-fy-leaderboard` | posts the FY friend leaderboard, to **`FRIEND_WEBHOOK_URL_FY`** |
| `post-main-leaderboard` | posts the main-account friend leaderboard, to **`MAIN_LEADERBOARD_CHANNEL_ID`** |

Each step is awaited and isolated: one failure is reported (to `DAILY_SCORE_CHANNEL_ID`)
but the remaining steps still run. `post-fy-leaderboard` and `post-main-leaderboard`
report as skipped rather than failed when their destination isn't configured.

**`CIRCLE_RUN_AT` (default 06:30)** — after maimai's maintenance window:
scrapes the top-100 circle rankings into `circle_rankings`, then posts the daily
points-gain report comparing the two newest snapshots.

Set `DAILY_PIPELINE_ENABLED=false` to disable the schedule and drive everything manually.

## 🎮 Slash commands

| Command | Purpose |
|---------|---------|
| `/daily` | Run the daily pipeline now (`all`, `scrape` only, or `post` only) |
| `/update` | Post the score diff using data already in Mongo |
| `/scraper` | Run the top-score scrape only |
| `/updatefriendsdata` | Scrape and save today's friend rating snapshot |
| `/friendsrating` | Post the friend leaderboard with comparison arrows |
| `/latestfriendsleaderboard` | Post the newest friend leaderboard, no arrows |
| `/circle` | Run the circle ranking scrape (`auto` / `force` / `none` webhook) |
| `/dailypoints` | Circle points-gain report for a date |
| `/constant` | Charts at a given difficulty constant (14.0–15.0) |

After adding or changing a command, re-register it:

```bash
docker compose exec bot node Discord_Bot/deploy-commands.js
```

## 🛠️ Setup

```bash
git clone https://github.com/admirable0531/maimaiscrape.git
cd maimaiscrape
cp .env.example .env    # then fill it in — see below
docker compose build
docker compose up -d
```

### Configuration

All credentials live in `.env`, which is gitignored. `Discord_Bot/config.js` holds
only non-secret values and reads every secret from the environment — there are no
hardcoded fallbacks, so **the bot will warn on startup and scrapes will fail** if a
variable is missing. See `.env.example` for the full list.

Required: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `MAIMAI_USER`, `MAIMAI_PASS`,
`MAIMAI_ACCOUNT_RATING_FY`, `MAIMAI_PASSWORD_RATING`, `FRIEND_WEBHOOK_URL_FY`,
`CIRCLE_WEBHOOK_URL`.

Optional: `MAIN_LEADERBOARD_CHANNEL_ID` — until set, `post-main-leaderboard`
reports as skipped every night instead of failing.

## 🗄️ Collections

| Collection | Written by | Contents |
|------------|------------|----------|
| `ryan_top`, `friend_<idx>_top` | `server/update_user_data.js` | Daily top-play snapshots (`new`, `old`, `rating`, `Date`) |
| `user_info` | `server/update_user_data.js` | Profile name / avatar / rating per day |
| `friend_rating_daily_snapshots` | `Discord_Bot/scripts/friends_webhook.js` | One document per day of friend ratings |
| `circle_rankings` | `Discord_Bot/scripts/circle_ranking_scraper.js` | Top-100 circle snapshots (7-day retention) |

Friends are keyed by the `friendIdx` from their maimai link, not by nickname.
`server/collectionNames.js` is the single source of truth for collection naming.

## 🧱 Layout

```
Discord_Bot/
  index.js            bot entry point; registers all cron schedules on ready
  config.js           non-secret config; secrets come from the environment
  lib/                shared helpers: mongo, webhook, format, maimai_session
  commands/           one folder per slash command
  scripts/            daily_pipeline, friends_webhook, circle_ranking_scraper, …
server/
  express_server.js   HTTP API + job trigger endpoints
  update_user_data.js Puppeteer top-score scraper
  update_score.js     builds the daily score-diff embeds
web/                  Vite front-end
```

Docker images mirror this layout under `/app`, so relative `require` paths behave
identically inside and outside a container.

## 🐍 Legacy Python

`app.py`, `update_user_data.py`, `requirements.txt` and the root `Dockerfile` are the
original Selenium/Firefox scraper. Nothing in `docker-compose.yml` references them —
they are superseded by `server/update_user_data.js` (Puppeteer) and can be removed.

See `DOCKER_COMMANDS.md` for manual/one-off runs.
