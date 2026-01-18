const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
    async execute(channel) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const day = today.getDate();
        const month = today.getMonth() + 1;
        const formattedDay = ('0' + day).slice(-2);
        const formattedYesterday = ('0' + yesterday.getDate()).slice(-2);
        const formattedYesterMonth = ('0' + (yesterday.getMonth() + 1)).slice(-2);
        const formattedMonth = ('0' + month).slice(-2);
        const yesterdayDate = formattedYesterday + '/' + formattedYesterMonth;
        const todayDate = formattedDay + '/' + formattedMonth;

        const dateEmbed = new EmbedBuilder().setColor(0x0099ff).setAuthor({
            name: yesterdayDate + ' -> ' + todayDate,
            iconURL: 'https://maimai.sega.jp/storage/area/region/universe/icon/03.png',
        });

        channel.send({ embeds: [dateEmbed] });

        // const uri = 'mongodb://mongodb:27017/mydatabase';
        const uri = config.MONGO_URI;
        const dbName = 'mydatabase';

        const users = config.users;
        const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

        for (const auser in users) {
            await fetchData(users[auser]);
        }

        async function fetchData(user) {
            try {
                await client.connect();

                const db = client.db(dbName);

                const collectionName = `${user}_top`;
                console.log(collectionName);
                const collection = db.collection(collectionName);

                const cursor = collection.find().sort({ _id: -1 }).limit(2);

                const documents = await cursor.toArray();
                const topSongsRecent = documents[0];
                const topSongsOld = documents[1];
                compareSongs(JSON.stringify(topSongsRecent), JSON.stringify(topSongsOld), user);
            } catch (error) {
                console.error('Error:', error);
            }
        }

        async function compareSongs(file1, file2, user) {
            let new_records = [];

            const data1 = JSON.parse(file1);
            const data2 = JSON.parse(file2);

            const rating1 = data1.rating;
            const rating2 = data2.rating;

            rating_diff = rating1 - rating2;
            const prefix = rating_diff >= 0 ? '+' : '-';
            const rating_diff_str = '(' + prefix + Math.abs(rating_diff).toString() + 'rt)';

            const missingInFile2New = data1.new.filter((entry) => {
                const correspondingEntry = data2.new.find(
                    (item) => item.Song === entry.Song && item.Diff === entry.Diff
                );
                if (correspondingEntry) {
                    return (
                        correspondingEntry.Rating !== entry.Rating ||
                        correspondingEntry.Achv !== entry.Achv
                    );
                }
                return true;
            });
            const missingInFile2Old = data1.old.filter((entry) => {
                const correspondingEntry = data2.old.find(
                    (item) => item.Song === entry.Song && item.Diff === entry.Diff
                );
                if (correspondingEntry) {
                    return (
                        correspondingEntry.Rating !== entry.Rating ||
                        correspondingEntry.Achv !== entry.Achv
                    );
                }
                return true;
            });

            if (missingInFile2New.length > 0) {
                console.log('Songs present in file1 but missing in file2:');
                missingInFile2New.forEach((song) => {
                    const matchingData = data1.new.find(
                        (data) => data.Song === song.Song && data.Diff === song.Diff
                    );
                    const songLink =
                        'https://arcade-songs.zetaraku.dev/maimai/?title=' +
                        encodeURIComponent(song.Song) +
                        '&types=' +
                        encodeURIComponent(matchingData.Chart.toLowerCase());
                    console.log(
                        `- Rank: ${matchingData.Rank}, Rating: ${matchingData.Rating}, Song: ${song.Song}, Chart: ${matchingData.Chart}, Level: ${matchingData.Level}, Achv: ${matchingData.Achv}`
                    );
                    new_records.push(
                        `${matchingData.Rank} | ${matchingData.Rating}rt | [${song.Song}](${songLink}) [${matchingData.Diff.toUpperCase()}] (${matchingData.Chart}) | ${matchingData.Level} | ${matchingData.Achv} | NEW`
                    );
                });
            } else {
                console.log('All songs in file1 are also present in file2.');
            }

            if (missingInFile2Old.length > 0) {
                console.log('Songs present in file1 but missing in file2:');
                missingInFile2Old.forEach((song) => {
                    const matchingData = data1.old.find(
                        (data) => data.Song === song.Song && data.Diff === song.Diff
                    );
                    const songLink =
                        'https://arcade-songs.zetaraku.dev/maimai/?title=' +
                        encodeURIComponent(song.Song) +
                        '&types=' +
                        encodeURIComponent(matchingData.Chart.toLowerCase());
                    console.log(
                        `- Rank: ${matchingData.Rank}, Rating: ${matchingData.Rating}, Song: ${song.Song}, Chart: ${matchingData.Chart}, Level: ${matchingData.Level}, Achv: ${matchingData.Achv}`
                    );
                    new_records.push(
                        `${matchingData.Rank} | ${matchingData.Rating}rt | [${song.Song}](${songLink}) [${matchingData.Diff.toUpperCase()}]  (${matchingData.Chart}) | ${matchingData.Level} | ${matchingData.Achv} | OLD`
                    );
                });
            } else {
                console.log('All songs in file1 are also present in file2.');
            }
            if (new_records.length === 0) {
            } else {
                const [user_img_src, user_name, user_rating] = await getUserInfo(user);
                const MAX_FIELDS = 25;

                for (let i = 0; i < new_records.length; i += MAX_FIELDS) {
                    const chunk = new_records.slice(i, i + MAX_FIELDS);

                    const embedChunk = new EmbedBuilder().setColor(0x7289da).setAuthor({
                        name: `${user_name} ${user_rating}rt ${rating_diff_str}`,
                        iconURL: user_img_src,
                    });

                    chunk.forEach((score) => {
                        embedChunk.addFields({ name: ' ', value: score });
                    });

                    channel.send({ embeds: [embedChunk] });
                }
            }
        }

        async function getUserInfo(user) {
            try {
                await client.connect();

                const db = client.db(dbName);

                const collection = db.collection('user_info');

                const cursor = collection.find({ user: user }).sort({ _id: -1 }).limit(1);
                const documents = await cursor.toArray();
                const document = documents[0];

                const img_src = document.img_src;
                const name = document.name;
                const rating = document.rating;

                return [img_src, name, rating];
            } catch (error) {
                console.error('Error:', error);
            }
        }
    },
};
