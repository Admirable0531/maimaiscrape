const { SlashCommandBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('topplay')
		.setDescription('Gets your top play'),
	async execute(interaction) {
        const uri = 'mongodb://localhost:27017';

        // Database Name
        const dbName = 'mydatabase';

        // Collection Name
        const collectionName = 'maimai';

        // Create a new MongoClient
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
                const cursor = collection.find().sort({ _id: -1 }).limit(1);

                // Iterate over the cursor to access each document
                const documents = await cursor.toArray();
                const topSongs = documents[0].records.slice(0, 5);
                console.log(JSON.stringify(topSongs));
                return topSongs;
            } catch (error) {
                console.error('Error:', error);
            } finally {
                // Close the connection
                await client.close();
            }
        }

        // Call the fetchData function to retrieve data
        const data = await fetchData();
		await interaction.reply(JSON.stringify(data));
	}
};