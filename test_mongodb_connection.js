#!/usr/bin/env node

// Test script for MongoDB connection in latestcirclerankings command
const { MongoClient } = require('mongodb');
const config = require('./Discord_Bot/config');

async function testMongoConnection() {
    console.log('Testing MongoDB connection for latestcirclerankings command...\n');

    try {
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
                console.log(`Trying to connect to: ${uri}`);
                client = new MongoClient(uri);
                await client.connect();
                // Test the connection
                await client.db('mydatabase').admin().ping();
                console.log(`✅ Successfully connected to: ${uri}`);
                connected = true;
                break;
            } catch (e) {
                console.log(`❌ Failed to connect to ${uri}: ${e.message}`);
                if (client) {
                    try { await client.close(); } catch (err) {}
                    client = null;
                }
            }
        }
        
        if (!connected || !client) {
            console.log('\n❌ Could not connect to any MongoDB instance');
            return;
        }
        
        const db = client.db('mydatabase');
        const collection = db.collection('circle_rankings');
        
        // Test the queries that the command uses
        console.log('\nTesting database queries...');
        
        // Get the latest snapshot
        const latestSnapshot = await collection
            .findOne({}, { sort: { scrapedAt: -1 } });

        if (!latestSnapshot) {
            console.log('❌ No snapshots found in database');
            await client.close();
            return;
        }
        
        console.log(`✅ Found latest snapshot: ${latestSnapshot.scrapedAt} with ${latestSnapshot.rankings.length} rankings`);

        // Get previous snapshot for comparison
        const snapshots = await collection
            .find({})
            .sort({ scrapedAt: -1 })
            .limit(2)
            .toArray();
        
        console.log(`✅ Found ${snapshots.length} snapshots for comparison`);
        
        // Close the connection
        await client.close();
        console.log('✅ Connection closed successfully');
        
        console.log('\n🎉 All tests passed! The latestcirclerankings command should work now.');

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
    }
}

testMongoConnection();