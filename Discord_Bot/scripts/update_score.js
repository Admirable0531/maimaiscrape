const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');

module.exports = {
	async execute(channel) {
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
        // 
        const users = ["ryan", "jiayi", "marcus", "kok", "yuan", "keyang"]
        const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        
        for (const auser in users) {
            const data = await fetchData(users[auser]);
        }

        async function fetchData(user) {
            try {
                // Connect to the MongoDB server
                await client.connect();

                // Access the database
                const db = client.db(dbName);

                // Access the collection
                const collectionName = `${user}_top`;
                console.log(collectionName)
                const collection = db.collection(collectionName);

                // Query the collection and retrieve data
                const cursor = collection.find().sort({ _id: -1 }).limit(2);

                // Iterate over the cursor to access each document
                const documents = await cursor.toArray();
                const topSongsRecent = documents[0];
                const topSongsOld = documents[1];
                compareSongs(JSON.stringify(topSongsRecent), JSON.stringify(topSongsOld), user)
                // return topSongs;
            } catch (error) {
                console.error('Error:', error);
            }
        }

        async function compareSongs(file1, file2, user) {
            let new_records=[];
            // Load JSON files
            const data1 = JSON.parse(file1);
            const data2 = JSON.parse(file2);

            const rating1 = data1.rating;
            const rating2 = data2.rating;


            rating_diff = rating1 - rating2;
            const prefix = rating_diff >= 0 ? '+' : '-';
            const rating_diff_str = "(" + prefix + Math.abs(rating_diff).toString() + "rt)";
        
            // Songs present in file1 but missing in file2
            const missingInFile2New = data1.new.filter(entry => {
                // Find the corresponding entry in file 2
                const correspondingEntry = data2.new.find(item => item.Song === entry.Song);

                // Check if the corresponding entry exists and if the ratings match
                return !correspondingEntry || correspondingEntry.Rating !== entry.Rating;
            });
            const missingInFile2Old = data1.old.filter(entry => {
                // Find the corresponding entry in file 2
                const correspondingEntry = data2.old.find(item => item.Song === entry.Song);
                
                // Check if the corresponding entry exists and if the ratings match
                return !correspondingEntry || correspondingEntry.Rating !== entry.Rating;
            });
        
            // Print songs present in file1 but missing in file2
            if (missingInFile2New.length > 0) {
                console.log("Songs present in file1 but missing in file2:");
                missingInFile2New.forEach( song => {
                    const matchingData = data1.new.find(data => data.Song === song.Song);
                    console.log(`- Rank: ${matchingData.Rank}, Rating: ${matchingData.Rating}, Song: ${song.Song}, Chart: ${matchingData.Chart}, Level: ${matchingData.Level}, Achv: ${matchingData.Achv}`);
                    new_records.push(`${matchingData.Rank} | ${matchingData.Rating}rt | ${song.Song} (${matchingData.Chart}) | ${matchingData.Level} | ${matchingData.Achv} | NEW`);
                    });
            } else {
                console.log("All songs in file1 are also present in file2.");
            }

            if (missingInFile2Old.length > 0) {
                console.log("Songs present in file1 but missing in file2:");
                missingInFile2Old.forEach( song => {
                    const matchingData = data1.old.find(data => data.Song === song.Song);
                    console.log(`- Rank: ${matchingData.Rank}, Rating: ${matchingData.Rating}, Song: ${song.Song}, Chart: ${matchingData.Chart}, Level: ${matchingData.Level}, Achv: ${matchingData.Achv}`);
                    new_records.push(`${matchingData.Rank} | ${matchingData.Rating}rt | ${song.Song} (${matchingData.Chart}) | ${matchingData.Level} | ${matchingData.Achv} | OLD`);
                    });
            } else {
                console.log("All songs in file1 are also present in file2.");
            }
            if(new_records.length === 0){

            } else {
                const [user_img_src, user_name, user_rating] = await getUserInfo(user);
                const newEmbed = new EmbedBuilder()
                    .setColor(0x7289da)
                    .setAuthor({ name: user_name + " " + user_rating + "rt " + rating_diff_str, iconURL: user_img_src})
                new_records.forEach(score => {
                    newEmbed.addFields({name: ' ', value: score},);
                });
                channel.send({ embeds: [newEmbed] });
            }
        }

        async function getUserInfo(user) {
            try {
                // Connect to the MongoDB server
                await client.connect();

                // Access the database
                const db = client.db(dbName);

                // Access the collection
                const collection = db.collection("user_info");

                // Query the collection and retrieve data
                const cursor = collection.find({ user: user }).sort({ _id: -1 }).limit(1);
                const documents = await cursor.toArray();
                const document = documents[0];

                const img_src = document.img_src;
                const name = document.name;
                const rating = document.rating;
                
                return [img_src, name, rating]
                // return topSongs;
            } catch (error) {
                console.error('Error:', error);
            }
        }
        
        // Call the fetchData function to retrieve data
    }
}