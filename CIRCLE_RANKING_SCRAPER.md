# Circle Ranking Scraper

Collects the top 100 circle rankings from the maimai DX NET circle ranking page.

## Files

- `Discord_Bot/scripts/circle_ranking_scraper.js` — the scraper
- `Discord_Bot/scripts/daily_points_tracker.js` — points-gain report over stored snapshots
- `Discord_Bot/commands/scraper/circle.js` — `/circle` manual trigger
- `Discord_Bot/commands/scraper/dailypoints.js` — `/dailypoints` manual report
- `Discord_Bot/commands/latestcirclerankings/latestcirclerankings.js` — `/latestcirclerankings`

Login, browser setup and error-page handling are shared with the friend-list
scraper via `Discord_Bot/lib/maimai_session.js`.

## Scheduling

**Once per day**, at `CIRCLE_RUN_AT` (default `06:30`, container timezone
`Asia/Kuala_Lumpur`) — after maimai's usual 03:00–06:00 maintenance window.

The daily points-gain report runs immediately afterwards in the same job, so it
always compares the two newest snapshots.

> Earlier revisions of this document described a 30-minute cadence with special
> runs at 02:55 and 06:05. That was never implemented; the schedule has always
> been a single daily run. If you do want a higher cadence, add a second
> `scheduleJob(...)` call in `Discord_Bot/index.js` — `daily_points_tracker.js`
> already handles multiple same-day snapshots (it then measures first→last within
> the day instead of day-over-day).

## Configuration

From `Discord_Bot/config.js`, all sourced from `.env`:

- `MAIMAI_ACCOUNT_RATING_FY` — Sega ID used to log in
- `MAIMAI_PASSWORD_RATING` — password
- `CIRCLE_WEBHOOK_URL` — Discord webhook for the report
- `MONGO_URI` — MongoDB connection string
- `CIRCLE_RUN_AT` — daily run time (`HH:MM`)

## Data

Collection `circle_rankings`, one document per scrape, pruned after 7 days:

```javascript
{
  snapshotDate: "2026-07-26",   // UTC calendar day
  rankings: [
    { rank: 1, groupName: "ＬＣω", points: 4829, pointsText: "4829 PT" },
    // … up to 100
  ],
  scrapedAt: ISODate("2026-07-26T22:30:00Z"),
  timestamp: 1785105000000
}
```

`rank` is assigned from the page's document order after sorting by points, so the
stored rank always matches the rank shown in Discord.

## Commands

### `/circle`
Runs the scraper on demand.

- `webhook` — `auto` (post only if something changed), `force` (always post),
  `none` (never post). Default `none`.
- `save` — write the snapshot to MongoDB. Default `true`.

`none` genuinely suppresses the post now; previously an explicit "no webhook"
still posted whenever changes were detected.

### `/latestcirclerankings`
Shows the latest stored rankings. `limit` defaults to 20, max 100.

### `/dailypoints`
Points-gain report. `date` (`YYYY-MM-DD`) defaults to the newest stored snapshot
date. `webhook` defaults to `false` for manual runs.

## Behaviour notes

- **Comparison baseline** is the most recent stored snapshot, read *before* the
  current scrape is saved. (It previously read the second-most-recent, so the
  arrows and point deltas described a comparison one run older than claimed.)
- **Maintenance detection** requires both the absence of a ranking table and
  maintenance wording on the page. Matching the word "maintenance" anywhere in the
  HTML — as the old check did — aborted healthy scrapes whenever an unrelated
  footer link mentioned it.
- **Embed limits** are enforced for both the 10-embeds and 6000-characters-per-message
  caps, so a full top-100 post can't be rejected by Discord.
- **Circles that drop out** of the top 100 are reported as dropped, not as having
  lost all their points.

## Debugging

```bash
# one-off run, no Discord post
docker compose exec bot node Discord_Bot/scripts/circle_ranking_scraper.js

# with screenshots (written to ./screenshots via the api service's volume)
docker compose exec -e SCREENSHOT_DEBUG=1 api node Discord_Bot/scripts/circle_ranking_scraper.js
```

- `HEADLESS=false` — show the browser window
- `SCREENSHOT_DEBUG=1` — save a screenshot at each login/scrape step
