#!/usr/bin/env node

// Test script for daily points tracker
const dailyPointsTracker = require('../../Discord_Bot/scripts/daily_points_tracker');

async function test() {
    console.log('Testing daily points tracker...');
    console.log('This will analyze the points gains for today (if enough data exists).\n');

    try {
        // Test with today's date first
        const today = new Date().toISOString().split('T')[0];
        console.log(`Trying today's date: ${today}`);
        
        let result = await dailyPointsTracker.run({
            sendWebhook: false, // Don't spam webhook during testing
            targetDate: today
        });

        if (!result.ok && result.error === 'insufficient data') {
            // Try yesterday's date
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            console.log(`\nTrying yesterday's date: ${yesterday}`);
            
            result = await dailyPointsTracker.run({
                sendWebhook: false,
                targetDate: yesterday
            });
        }

        console.log('\n=== Test Results ===');
        console.log('Success:', result.ok);
        
        if (result.ok) {
            console.log('Date analyzed:', result.date);
            console.log('Teams analyzed:', result.teamsAnalyzed);
            console.log('Snapshots used:', result.totalSnapshots);
            console.log('\n✅ Test passed! Daily points tracker is working.');
        } else {
            console.log('Error:', result.error);
            if (result.error === 'insufficient data') {
                console.log('\n⚠️ This is normal if there aren\'t enough snapshots yet.');
                console.log('The tracker needs at least 2 snapshots from the same day to work.');
                console.log('Try running the circle scraper a few times first.');
            } else {
                console.log('\n❌ Test failed with unexpected error.');
            }
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        console.error(error.stack);
    }
}

test();