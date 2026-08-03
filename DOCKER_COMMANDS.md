# Running commands inside Docker (e.g. over SSH on the Raspberry Pi)

Run these from the project directory on the Pi (`~/Desktop/maimaiscrape`).

Images mirror the repository layout under `/app`, so paths are the same as in the
repo: `Discord_Bot/...` and `server/...`.

---

## Everyday operations

```bash
# Rebuild and restart everything
docker compose up -d --build

# Follow logs
docker compose logs -f bot
docker compose logs -f api

# Re-register slash commands (needed after adding or editing one)
docker compose exec bot node Discord_Bot/deploy-commands.js
```

## Run the daily pipeline now

Easiest is `/daily` in Discord. From the shell, trigger the individual steps:

```bash
# Step 1 – top scores + profiles
curl -X POST http://localhost:3000/run-update-user-data

# Step 2 – friend rating snapshot
curl -X POST http://localhost:3000/run-friends-webhook \
  -H 'Content-Type: application/json' \
  -d '{"accountType":"fy","saveToMongo":true,"sendWebhook":false}'

# Step 3 – build the score-diff embeds (returns them as JSON)
curl -X POST http://localhost:3000/run-update-score
```

These endpoints refuse to run twice at once and answer `409` if a job is already
in flight.

## One-off scraper runs

The `scraper` service is in the `manual` profile, so `docker compose up` does not
start it. Use `run` for a one-off:

```bash
docker compose run --rm scraper node server/update_user_data.js
```

Individual scripts can also be run in the bot container:

```bash
docker compose exec bot node Discord_Bot/scripts/friends_webhook.js
docker compose exec bot node Discord_Bot/scripts/circle_ranking_scraper.js
docker compose exec bot node Discord_Bot/scripts/daily_points_tracker.js
```

## Screenshots / watching the browser

**Screenshots (works over plain SSH).** The `api` and `scraper` services mount
`./screenshots`, so files land in the project directory:

```bash
docker compose run --rm -e SCREENSHOT_DEBUG=1 scraper node server/update_user_data.js
ls ./screenshots/
```

**Visible browser on the Pi (monitor attached).** Run on the host, not in Docker,
so Chromium can use the Pi's display. On ARM you need system Chromium installed —
Puppeteer's bundled build is x86 only:

```bash
sudo apt update && sudo apt install chromium
cd ~/Desktop/maimaiscrape
npm install
HEADLESS=false DISPLAY=:0 MONGO_URI=mongodb://localhost:27017/mydatabase \
  node server/update_user_data.js
```

**Visible browser over SSH (window on your laptop).** Connect with X11 forwarding
and run on the host. Requires an X server locally (XQuartz on macOS, VcXsrv on
Windows):

```bash
ssh -X pi@<pi-ip>
cd ~/Desktop/maimaiscrape
HEADLESS=false npm run scraper
```

## Debug scripts

Ad-hoc manual verification scripts (not part of any automated suite) live in
`scripts/debug/` — e.g. `node scripts/debug/test_mongodb_connection.js`.

## Migration (old name collections → friendIdx)

Run once to copy `yuchen_top` etc. into `friend_6020500221031_top` and update
`user_info`:

```bash
docker compose exec api node server/scripts/migrate-collections-to-friend-idx.js
```

## Shells

```bash
docker compose exec bot sh
docker compose exec api sh
docker compose exec mongodb mongo mydatabase
```

## Reference

| What | Command |
|------|---------|
| Rebuild + restart | `docker compose up -d --build` |
| Bot logs | `docker compose logs -f bot` |
| Re-register commands | `docker compose exec bot node Discord_Bot/deploy-commands.js` |
| Manual scraper run | `docker compose run --rm scraper node server/update_user_data.js` |
| Migration | `docker compose exec api node server/scripts/migrate-collections-to-friend-idx.js` |
| Mongo shell | `docker compose exec mongodb mongo mydatabase` |
