const { SlashCommandBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('dailyupdate')
		.setDescription('Update rating gains daily'),
	async execute(interaction) {
        const channel = interaction.channel;
        var today = new Date();
        var day = today.getDate();
        var month = today.getMonth() + 1;
        var formattedDay = ("0" + day).slice(-2);
        var formattedYesterday = ("0" + (day-1)).slice(-2);
        var formattedMonth = ("0" + month).slice(-2);
        var yesterdayDate = formattedYesterday + "/" + formattedMonth;
        var todayDate = formattedDay + "/" + formattedMonth;

        const exampleEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setAuthor({ name: yesterdayDate + " -> " + todayDate, iconURL: 'https://maimai.sega.jp/storage/area/region/universe/icon/03.png'})

        channel.send({ embeds: [exampleEmbed] });
        
        const uri = 'mongodb://localhost:27017';
        const dbName = 'mydatabase';
        const collectionName = 'ryan_top';
        const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

        async function fetchData() {
            try {
                // Connect to the MongoDB server
                await client.connect();

                // Access the database
                const db = client.db(dbName);

                // Access the collection
                const collection = db.collection(collectionName);

                // Query the collection and retrieve data
                const cursor = collection.find().sort({ _id: -1 }).limit(2);

                // Iterate over the cursor to access each document
                const documents = await cursor.toArray();
                const topSongsRecent = documents[0].new;
                const topSongsOld = documents[1].new;
                console.log(JSON.stringify(topSongsRecent));
                console.log(JSON.stringify(topSongsOld));
                compareSongs(JSON.stringify(topSongsRecent), JSON.stringify(topSongsOld))
                // return topSongs;
            } catch (error) {
                console.error('Error:', error);
            } finally {
                // Close the connection
                await client.close();
            }
        }

        // Call the fetchData function to retrieve data
        const data = await fetchData();

        function compareSongs(file1, file2) {
            // Load JSON files
            const data1 = JSON.parse(file1);
            const data2 = JSON.parse(file2);
        
            // Extract song names
            const songsInFile1 = new Set(data1.map(song => song.Song));
            const songsInFile2 = new Set(data2.map(song => song.Song));
        
            // Find common songs
            const commonSongs = new Set([...songsInFile1].filter(song => songsInFile2.has(song)));
        
            // Songs present in file1 but missing in file2
            const missingInFile2 = [...songsInFile1].filter(song => !songsInFile2.has(song));
        
            // Print songs present in file1 but missing in file2
            if (missingInFile2.length > 0) {
                console.log("Songs present in file1 but missing in file2:");
                missingInFile2.forEach(song => {
                    const matchingData = data1.find(data => data.Song === song);
                    console.log(`- Rank: ${matchingData.Rank}, Rating: ${matchingData.Rating}, Song: ${song}, Chart: ${matchingData.Chart}, Level: ${matchingData.Level}, Achv: ${matchingData.Achv}`);
                    const newEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setAuthor({ name: yesterdayDate + " -> " + todayDate, iconURL: 'https://maimai.sega.jp/storage/area/region/universe/icon/03.png'})
        
                    channel.send({ embeds: [newEmbed] });
                });
            } else {
                console.log("All songs in file1 are also present in file2.");
            }
        }
    }
}