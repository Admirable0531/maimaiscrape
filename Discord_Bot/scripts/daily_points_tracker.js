const { MongoClient } = require('mongodb');
const config = require('../config');
const https = require('https');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCalendarDayUTC(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function sendToWebhook(webhookUrl, embeds) {
    if (!webhookUrl) {
        console.error('Webhook URL is not set; cannot send to Discord.');
        return Promise.resolve(false);
    }
    try {
        const url = new URL(webhookUrl);
        const payload = JSON.stringify({ embeds });

        const options = {
            method: 'POST',
            hostname: url.hostname,
            path: url.pathname + (url.search || ''),
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(true);
                    } else {
                        console.error('Webhook responded with status', res.statusCode, data);
                        resolve(false);
                    }
                });
            });
            req.on('error', (err) => {
                console.error('Error sending to webhook:', err);
                resolve(false);
            });
            req.write(payload);
            req.end();
        });
    } catch (e) {
        console.error('Invalid webhook URL:', e.message);
        return Promise.resolve(false);
    }
}

async function connectToMongoDB() {
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
        throw new Error('Could not connect to MongoDB');
    }
    
    return client;
}

async function getDailyPointsGains(targetDate = null) {
    const client = await connectToMongoDB();
    
    try {
        const db = client.db('mydatabase');
        const collection = db.collection('circle_rankings');
        
        // Use provided date or yesterday (since we run this at 3 AM for the previous day)
        const dateToCheck = targetDate || getCalendarDayUTC(new Date(Date.now() - 24 * 60 * 60 * 1000));
        
        console.log(`[daily-points] analyzing gains for ${dateToCheck}`);
        
        // Get all snapshots for the target date, sorted by time
        const daySnapshots = await collection
            .find({ snapshotDate: dateToCheck })
            .sort({ scrapedAt: 1 })
            .toArray();

        let firstSnapshot;
        let lastSnapshot;
        let totalSnapshots;

        if (daySnapshots.length >= 2) {
            firstSnapshot = daySnapshots[0];
            lastSnapshot = daySnapshots[daySnapshots.length - 1];
            totalSnapshots = daySnapshots.length;
            console.log(`[daily-points] comparing ${totalSnapshots} same-day snapshots from ${firstSnapshot.scrapedAt} to ${lastSnapshot.scrapedAt}`);
        } else if (daySnapshots.length === 1) {
            // One scrape per day: compare this day vs the latest snapshot before dateToCheck
            lastSnapshot = daySnapshots[0];
            const prevDocs = await collection
                .find({ snapshotDate: { $lt: dateToCheck } })
                .sort({ scrapedAt: -1 })
                .limit(1)
                .toArray();
            if (prevDocs.length === 0) {
                console.log(`[daily-points] insufficient data: one snapshot for ${dateToCheck} but no prior day`);
                return null;
            }
            firstSnapshot = prevDocs[0];
            totalSnapshots = 2;
            console.log(
                `[daily-points] single snapshot for ${dateToCheck}; comparing prior ${firstSnapshot.snapshotDate} @ ${firstSnapshot.scrapedAt} → ${lastSnapshot.scrapedAt}`
            );
        } else {
            console.log(`[daily-points] insufficient data: no snapshots for ${dateToCheck}`);
            return null;
        }
        
        // Create maps for easier lookup
        const firstMap = new Map();
        const lastMap = new Map();
        
        firstSnapshot.rankings.forEach(r => {
            firstMap.set(r.groupName, r.points);
        });
        
        lastSnapshot.rankings.forEach(r => {
            lastMap.set(r.groupName, r.points);
        });
        
        // Calculate gains for all teams
        const pointsGains = [];
        
        // Check teams that were in both snapshots
        for (const [groupName, lastPoints] of lastMap) {
            const firstPoints = firstMap.get(groupName);
            if (firstPoints !== undefined) {
                const gain = lastPoints - firstPoints;
                pointsGains.push({
                    groupName,
                    startPoints: firstPoints,
                    endPoints: lastPoints,
                    pointsGain: gain,
                    percentageGain: firstPoints > 0 ? ((gain / firstPoints) * 100) : 0
                });
            } else {
                // New team that appeared during the day
                pointsGains.push({
                    groupName,
                    startPoints: 0,
                    endPoints: lastPoints,
                    pointsGain: lastPoints,
                    percentageGain: 0,
                    isNew: true
                });
            }
        }
        
        // Check for teams that disappeared during the day
        for (const [groupName, firstPoints] of firstMap) {
            if (!lastMap.has(groupName)) {
                pointsGains.push({
                    groupName,
                    startPoints: firstPoints,
                    endPoints: 0,
                    pointsGain: -firstPoints,
                    percentageGain: -100,
                    disappeared: true
                });
            }
        }
        
        // Sort by points gained (highest first)
        pointsGains.sort((a, b) => b.pointsGain - a.pointsGain);
        
        return {
            date: dateToCheck,
            firstSnapshot: {
                time: firstSnapshot.scrapedAt,
                totalTeams: firstSnapshot.rankings.length
            },
            lastSnapshot: {
                time: lastSnapshot.scrapedAt,
                totalTeams: lastSnapshot.rankings.length
            },
            totalSnapshots,
            pointsGains
        };
        
    } finally {
        await client.close();
    }
}

function buildDailyPointsEmbed(data) {
    if (!data || !data.pointsGains || data.pointsGains.length === 0) {
        return [{
            title: '📈 Daily Points Gains',
            description: 'No data available for daily points calculation.',
            color: 0xff0000,
        }];
    }
    
    const { date, firstSnapshot, lastSnapshot, totalSnapshots, pointsGains } = data;
    
    // Filter and categorize gains
    const topGainers = pointsGains.filter(g => g.pointsGain > 0).slice(0, 20);
    const smallGainers = pointsGains.filter(g => g.pointsGain > 0 && g.pointsGain < 50).slice(0, 10);
    const noChange = pointsGains.filter(g => g.pointsGain === 0).length;
    const negativeGains = pointsGains.filter(g => g.pointsGain < 0);
    
    // Calculate totals
    const totalGains = pointsGains.reduce((sum, g) => sum + Math.max(0, g.pointsGain), 0);
    const totalNegative = pointsGains.reduce((sum, g) => sum + Math.min(0, g.pointsGain), 0);
    
    // Most teams should only gain points, so negative changes are unusual
    const hasNegativeChanges = negativeGains.length > 0;
    
    const divider = '═══════════════════════════════════════════════════════════════';
    const headerText = '📈 **DAILY POINTS GAINS REPORT** 📈\n📊 **Top Performers & Biggest Movers** 📊';
    
    // Build description sections
    const sections = [];
    
    // Header with summary
    sections.push(`${divider}\n${headerText}\n${divider}\n`);
    sections.push(`**📅 Date:** ${date}`);
    sections.push(`**⏰ Period:** ${firstSnapshot.time.toLocaleString()} → ${lastSnapshot.time.toLocaleString()}`);
    sections.push(`**📊 Snapshots:** ${totalSnapshots} updates tracked`);
    sections.push(`**📈 Total Points Gained:** ${totalGains.toLocaleString()} PT`);
    sections.push(`**🏆 Teams with Gains:** ${topGainers.length}`);
    sections.push(`**➖ No Change:** ${noChange} teams`);
    if (hasNegativeChanges) {
        sections.push(`**⚠️ Unusual Decreases:** ${negativeGains.length} teams`);
    }
    sections.push('');
    
    // Top gainers
    if (topGainers.length > 0) {
        sections.push('**🏆 TOP GAINERS OF THE DAY**');
        topGainers.forEach((team, index) => {
            const rank = index + 1;
            const rankStr = rank.toString().padStart(2, '0');
            const gainStr = `+${team.pointsGain.toLocaleString()}`;
            const percentStr = team.percentageGain > 0 ? ` (+${team.percentageGain.toFixed(1)}%)` : '';
            const newTag = team.isNew ? ' 🆕' : '';
            
            sections.push(`\`${rankStr}.\` **${team.groupName}** — ${gainStr} PT${percentStr}${newTag}`);
        });
        sections.push('');
    }
    
    // Show unusual negative changes if any (this shouldn't normally happen)
    if (hasNegativeChanges && negativeGains.length > 0) {
        sections.push('**⚠️ UNUSUAL POINT DECREASES** (This may indicate data issues)');
        negativeGains.slice(0, 5).forEach((team, index) => {
            const rank = index + 1;
            const rankStr = rank.toString().padStart(2, '0');
            const changeStr = team.pointsGain.toLocaleString();
            const goneTag = team.disappeared ? ' 👻' : '';
            
            sections.push(`\`${rankStr}.\` **${team.groupName}** — ${changeStr} PT${goneTag}`);
        });
        sections.push('');
    }
    
    // Show some moderate gainers if we have space
    if (topGainers.length < 15 && smallGainers.length > 0) {
        const remainingSlots = Math.min(10, 15 - topGainers.length);
        const moderateGainers = pointsGains
            .filter(g => g.pointsGain > 0 && g.pointsGain >= 10 && g.pointsGain < 100)
            .slice(0, remainingSlots);
            
        if (moderateGainers.length > 0) {
            sections.push('**📊 STEADY PERFORMERS**');
            moderateGainers.forEach((team, index) => {
                const rank = index + 1;
                const rankStr = rank.toString().padStart(2, '0');
                const gainStr = `+${team.pointsGain.toLocaleString()}`;
                const percentStr = team.percentageGain > 0 ? ` (+${team.percentageGain.toFixed(1)}%)` : '';
                
                sections.push(`\`${rankStr}.\` **${team.groupName}** — ${gainStr} PT${percentStr}`);
            });
        }
    }
    
    const description = sections.join('\n');
    
    // Split into chunks if too long
    const MAX_CHARS = 4000;
    if (description.length <= MAX_CHARS) {
        return [{
            title: '📈 Daily Points Gains Report',
            description,
            color: 0x00ff00, // Green for gains
            footer: {
                text: `Generated: ${new Date().toLocaleString()} • Period: ${totalSnapshots} updates`
            }
        }];
    }
    
    // Split into multiple embeds if needed
    const chunks = [];
    const lines = sections;
    let current = [];
    let currentLen = 0;
    
    for (const line of lines) {
        if (currentLen + line.length + 1 > MAX_CHARS && current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    }
    if (current.length > 0) {
        chunks.push(current.join('\n'));
    }
    
    return chunks.map((desc, idx) => ({
        title: idx === 0 ? '📈 Daily Points Gains Report' : `Daily Points Report (cont. ${idx + 1})`,
        description: desc,
        color: 0x00ff00,
        footer: {
            text: `Generated: ${new Date().toLocaleString()} • Period: ${totalSnapshots} updates`
        }
    }));
}

async function run(opts = {}) {
    const sendWebhook = opts.sendWebhook ?? true;
    const targetDate = opts.targetDate || null;
    const webhookUrl = config.CIRCLE_WEBHOOK_URL;

    console.log('[daily-points] starting daily points gain analysis');

    try {
        const data = await getDailyPointsGains(targetDate);
        
        if (!data) {
            console.log('[daily-points] insufficient data for analysis');
            if (sendWebhook) {
                const errorEmbed = [{
                    title: '📈 Daily Points Gains - No Data',
                    description: 'Insufficient data to calculate daily points gains. Need at least 2 snapshots for the day.',
                    color: 0xffa500,
                    footer: {
                        text: `Checked at: ${new Date().toLocaleString()}`
                    }
                }];
                await sendToWebhook(webhookUrl, errorEmbed);
            }
            return { ok: false, error: 'insufficient data' };
        }
        
        if (sendWebhook) {
            const embeds = buildDailyPointsEmbed(data);
            
            // Send embeds (Discord webhook limit: 10 embeds per message)
            const MAX_EMBEDS_PER_MESSAGE = 10;
            
            for (let i = 0; i < embeds.length; i += MAX_EMBEDS_PER_MESSAGE) {
                const embedChunk = embeds.slice(i, i + MAX_EMBEDS_PER_MESSAGE);
                console.log(`[daily-points][webhook] sending ${embedChunk.length} embeds (${i + 1}-${i + embedChunk.length} of ${embeds.length})`);
                await sendToWebhook(webhookUrl, embedChunk);
                
                // Small delay between messages if sending multiple batches
                if (i + MAX_EMBEDS_PER_MESSAGE < embeds.length) {
                    await delay(1000);
                }
            }
        }
        
        console.log(`[daily-points] analysis completed: ${data.pointsGains.length} teams analyzed`);
        return { 
            ok: true, 
            date: data.date,
            teamsAnalyzed: data.pointsGains.length,
            totalSnapshots: data.totalSnapshots
        };
        
    } catch (e) {
        console.error('Error in daily points tracker:', e);
        return { ok: false, error: String(e) };
    }
}

if (require.main === module) {
    run()
        .then((result) => {
            console.log('[daily-points] completed:', result);
            process.exit(0);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { run, getDailyPointsGains };