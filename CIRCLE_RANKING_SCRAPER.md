# Circle Ranking Scraper

This scraper collects the top 100 circle rankings from the maimai DX NET circle ranking page.

## Features

- **Automated Scraping**: Runs every 30 minutes via cron job
- **Smart Scheduling**: Avoids maintenance hours (3-6 AM JST) and problematic minutes (:25, :55)
- **Maintenance Detection**: Automatically detects and handles maintenance periods
- **MongoDB Storage**: Saves daily snapshots of rankings to `circle_rankings` collection
- **Discord Integration**: Sends formatted rankings to Discord webhook
- **Manual Commands**: Discord slash commands for manual triggering and viewing

## Files

- `Discord_Bot/scripts/circle_ranking_scraper.js` - Main scraper script
- `Discord_Bot/commands/scraper/circle.js` - Manual trigger command
- `Discord_Bot/commands/latestcirclerankings/latestcirclerankings.js` - View latest rankings command
- `test_circle_scraper.js` - Test script

## Configuration

The scraper uses the following config values from `Discord_Bot/config.js`:

- `MAIMAI_ACCOUNT_RATING_FY` - Username for login (as requested)
- `MAIMAI_PASSWORD_RATING` - Password for login
- `FRIEND_WEBHOOK_URL_FY` - Discord webhook URL for posting results
- `MONGO_URI` - MongoDB connection string

## Scheduling

The scraper runs automatically with the following schedule:

- **Normal Hours**: Every 30 minutes at :00 and :30
- **Maintenance Hours**: 3:00 AM - 6:00 AM MYT (Malaysia Time, UTC+8)
  - **2:55 AM MYT**: Special run before maintenance starts (instead of 3:00 AM)
  - **6:05 AM MYT**: Special run after maintenance ends (instead of 6:00 AM)
  - **During maintenance**: All other times are skipped
- **Timezone**: Uses MYT (Malaysia Time, UTC+8) for maintenance window calculation

## Data Structure

### MongoDB Collection: `circle_rankings`

```javascript
{
  snapshotDate: "2026-04-02",        // UTC date string
  rankings: [
    {
      rank: 1,                       // Position in ranking
      groupName: "ＬＣω",            // Circle/group name
      points: 4829,                  // Numeric points value
      pointsText: "4829 PT"         // Original text from page
    },
    // ... up to 100 rankings
  ],
  scrapedAt: ISODate("2026-04-02T10:30:00Z")
}
```

## Discord Commands

### `/circle`
Manually trigger the circle ranking scraper.

Options:
- `webhook` (boolean): Send results to webhook (default: false for manual runs)
- `save` (boolean): Save to MongoDB (default: true)

### `/latestcirclerankings`
View the latest circle rankings from the database.

Options:
- `limit` (integer): Number of rankings to show (default: 20, max: 100)

## Testing

Run the test script to verify the scraper works:

```bash
node test_circle_scraper.js
```

For debugging, set these environment variables:
- `HEADLESS=false` - Show browser window
- `SCREENSHOT_DEBUG=true` - Save screenshots during scraping

## Error Handling

The scraper handles several error conditions:

1. **Maintenance Mode**: Detects maintenance pages and skips scraping
2. **Login Failures**: Retries with different user agents
3. **Network Issues**: Timeout handling and retry logic  
4. **Page Structure Changes**: Graceful degradation if elements not found
5. **Discord Webhook Failures**: Logs errors but continues operation

## Webhook Format

Results are sent to Discord as embeds with:
- Title: "Circle Rankings - Top 100"
- Color-coded status (blue for success, red for errors, orange for maintenance)
- Formatted ranking list with group names and points
- Footer with total count and timestamp
- Multiple embeds if needed to fit all rankings

## Maintenance Window

The scraper automatically handles maimai maintenance periods:
- **Scheduled**: 3:00 AM - 6:00 AM MYT (daily maintenance window)
  - **2:55 AM MYT**: Runs before maintenance starts
  - **6:05 AM MYT**: Runs after maintenance ends
  - **3:00 AM - 6:00 AM MYT**: All regular runs are skipped
- **Unscheduled**: Detected by page content analysis
- **Behavior**: Adjusts timing and optionally notifies via webhook

## Integration

The circle ranking scraper integrates with the existing Discord bot infrastructure:
- Uses same login credentials and browser configuration
- Follows same error handling and screenshot patterns
- Shares MongoDB connection and webhook utilities
- Consistent logging and debugging approach