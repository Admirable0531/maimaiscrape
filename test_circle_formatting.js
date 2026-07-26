#!/usr/bin/env node

// Test script to verify circle ranking formatting
const { MongoClient } = require('mongodb');
const config = require('./Discord_Bot/config');

async function testFormatting() {
    console.log('Testing circle ranking formatting...\n');

    // Try different MongoDB URIs for Docker vs local environments
    const mongoUris = [
        config.MONGO_URI, // Docker URI: mongodb://mongodb:27017/mydatabase
        'mongodb://localhost:27017/mydatabase', // Local URI
        'mongodb://127.0.0.1:27017/mydatabase'  // Alternative local URI
    ];
    
    let client = null;
    let connected = false;
    
    for (const uri of mongoUris) {
        try {
            client = new MongoClient(uri);
            await client.connect();
            // Test the connection
            await client.db('mydatabase').admin().ping();
            connected = true;
            break;
        } catch (e) {
            if (client) {
                try { await client.close(); } catch (err) {}
                client = null;
            }
        }
    }
    
    if (!connected || !client) {
        console.log('❌ Could not connect to MongoDB');
        return;
    }

    try {
        const db = client.db('mydatabase');
        const collection = db.collection('circle_rankings');
        
        // Get the latest snapshot
        const latestSnapshot = await collection
            .findOne({}, { sort: { scrapedAt: -1 } });
        
        if (!latestSnapshot || !latestSnapshot.rankings) {
            console.log('❌ No rankings found in database');
            return;
        }

        // Sort by points (highest first) and show top 10
        const sorted = latestSnapshot.rankings
            .sort((a, b) => {
                if (b.points !== a.points) {
                    return b.points - a.points;
                }
                return a.groupName.localeCompare(b.groupName);
            })
            .slice(0, 10);

        console.log('✅ Top 10 Circle Rankings (sorted by points):');
        console.log('='.repeat(50));
        
        sorted.forEach((ranking, index) => {
            const rank = index + 1;
            const rankStr = rank.toString().padStart(2, '0');
            console.log(`${rankStr}. ${ranking.groupName} — ${ranking.points.toLocaleString()} PT`);
        });
        
        console.log('='.repeat(50));
        console.log(`Total rankings: ${latestSnapshot.rankings.length}`);
        console.log(`Scraped at: ${latestSnapshot.scrapedAt}`);
        
        // Test comparison logic
        const snapshots = await collection
            .find({})
            .sort({ scrapedAt: -1 })
            .limit(2)
            .toArray();
        
        if (snapshots.length >= 2) {
            console.log('\n🔄 Comparison with previous snapshot available');
            const prevRankings = snapshots[1].rankings;
            
            // Create comparison map
            const prevMap = new Map();
            const prevSorted = prevRankings.sort((a, b) => {
                if (b.points !== a.points) {
                    return b.points - a.points;
                }
                return a.groupName.localeCompare(b.groupName);
            });
            prevSorted.forEach((r, index) => {
                prevMap.set(r.groupName, { 
                    rank: index + 1, 
                    points: r.points 
                });
            });
            
            console.log('\nTop 5 with comparison indicators:');
            console.log('-'.repeat(50));
            
            sorted.slice(0, 5).forEach((ranking, index) => {
                const currentRank = index + 1;
                const rankStr = currentRank.toString().padStart(2, '0');
                
                let changeIndicator = '';
                let pointsChangeIndicator = '';
                
                if (prevMap.has(ranking.groupName)) {
                    const prev = prevMap.get(ranking.groupName);
                    const rankChange = prev.rank - currentRank;
                    const pointsChange = ranking.points - prev.points;
                    
                    if (rankChange > 0) {
                        changeIndicator = ` ⬆️${rankChange}`;
                    } else if (rankChange < 0) {
                        changeIndicator = ` ⬇️${Math.abs(rankChange)}`;
                    } else {
                        changeIndicator = ' ➖';
                    }
                    
                    if (pointsChange > 0) {
                        pointsChangeIndicator = ` (+${pointsChange.toLocaleString()})`;
                    } else if (pointsChange < 0) {
                        pointsChangeIndicator = ` (${pointsChange.toLocaleString()})`;
                    }
                } else {
                    changeIndicator = ' 🆕';
                }
                
                console.log(`${rankStr}. ${ranking.groupName} — ${ranking.points.toLocaleString()} PT${pointsChangeIndicator}${changeIndicator}`);
            });
        } else {
            console.log('\n⚠️ Only one snapshot available, no comparison possible');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (e) {}
        }
    }
}

testFormatting();