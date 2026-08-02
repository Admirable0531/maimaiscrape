#!/usr/bin/env node

// Test script for circle ranking scraper
const circleRankingScraper = require('../../Discord_Bot/scripts/circle_ranking_scraper');

async function test() {
    console.log('Testing circle ranking scraper...');
    console.log('This will attempt to login and scrape circle rankings.');
    console.log('Set HEADLESS=false to see the browser in action.');
    console.log('Set SCREENSHOT_DEBUG=true to save screenshots.\n');

    try {
        const result = await circleRankingScraper.run({
            sendWebhook: false, // Don't spam webhook during testing
            saveToMongo: true   // Save to database for testing
        });

        console.log('\n=== Test Results ===');
        console.log('Success:', result.ok);
        console.log('Rankings found:', result.rankingsCount);
        
        if (result.maintenance) {
            console.log('Status: Maintenance detected');
        } else if (result.error) {
            console.log('Error:', result.error);
        } else {
            console.log('Status: Scraping completed successfully');
        }

        if (result.ok && result.rankingsCount > 0) {
            console.log('\n✅ Test passed! Circle ranking scraper is working.');
        } else {
            console.log('\n❌ Test failed or no data found.');
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        console.error(error.stack);
    }
}

test();