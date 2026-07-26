const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const config = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('latestcirclerankings')
        .setDescription('Show the latest circle rankings from database')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of rankings to show (default: 20, max: 100)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(100)),
    async execute(interaction) {
        await interaction.deferReply();

        const limit = interaction.options.getInteger('limit') ?? 20;

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
                await interaction.editReply({
                    content: '❌ Could not connect to MongoDB. Make sure the database is running.',
                });
                return;
            }
            
            const db = client.db('mydatabase');
            const collection = db.collection('circle_rankings');
            
            // Get the latest snapshot
            const latestSnapshot = await collection
                .findOne({}, { sort: { scrapedAt: -1 } });

            if (!latestSnapshot || !latestSnapshot.rankings || latestSnapshot.rankings.length === 0) {
                await client.close();
                await interaction.editReply({
                    content: '❌ No circle rankings found in database. Run the scraper first with `/circle`.',
                });
                return;
            }

            // Get previous snapshot for comparison
            const snapshots = await collection
                .find({})
                .sort({ scrapedAt: -1 })
                .limit(2)
                .toArray();
            
            // Close the connection after all queries are done
            await client.close();
            
            const previousSnapshot = snapshots.length >= 2 ? snapshots[1] : null;
            
            // Sort by points (highest first) instead of rank
            const rankings = latestSnapshot.rankings
                .sort((a, b) => {
                    if (b.points !== a.points) {
                        return b.points - a.points;
                    }
                    return a.groupName.localeCompare(b.groupName);
                })
                .slice(0, limit);
            
            // Create comparison map
            const prevMap = new Map();
            if (previousSnapshot && previousSnapshot.rankings) {
                const prevSorted = previousSnapshot.rankings.sort((a, b) => {
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
            }

            // Create embed(s)
            const embeds = [];
            const maxPerEmbed = 25; // Discord embed field limit
            
            for (let i = 0; i < rankings.length; i += maxPerEmbed) {
                const chunk = rankings.slice(i, i + maxPerEmbed);
                const embed = new EmbedBuilder()
                    .setTitle(i === 0 ? 'Latest Circle Rankings' : `Circle Rankings (cont.)`)
                    .setColor(0x7289da)
                    .setFooter({
                        text: `Scraped: ${latestSnapshot.scrapedAt.toLocaleString()} • Total: ${latestSnapshot.rankings.length} circles`
                    });

                // Add rankings as fields with comparison
                chunk.forEach((ranking, chunkIndex) => {
                    const currentRank = (i + chunkIndex + 1);
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
                    
                    embed.addFields({
                        name: `${rankStr}. ${ranking.groupName}`,
                        value: `${ranking.points.toLocaleString()} PT${pointsChangeIndicator}${changeIndicator}`,
                        inline: true
                    });
                });

                embeds.push(embed);
            }

            // Send embeds (Discord allows up to 10 embeds per message)
            const embedsToSend = embeds.slice(0, 10);
            await interaction.editReply({ embeds: embedsToSend });

            if (embeds.length > 10) {
                await interaction.followUp({
                    content: `⚠️ Only showing first ${embedsToSend.length * maxPerEmbed} rankings due to Discord limits.`,
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error fetching circle rankings:', error);
            await interaction.editReply({
                content: `❌ Error fetching circle rankings: ${error.message}`,
            });
        }
    },
};