const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { getTopCollectionName, getFriendIdxFromOldName } = require('./collectionNames');

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

        const uri = config.MONGO_URI;
        const dbName = 'mydatabase';

        const client = new MongoClient(uri);

        // Same as scraper/web API: use user_info to get ryan + friendIdxs, so we only use ryan_top and friend_<idx>_top
        let users = [];
        try {
            await client.connect();
            const db = client.db(dbName);
            const userInfoCol = db.collection('user_info');
            const docs = await userInfoCol.find({}).sort({ _id: -1 }).toArray();
            const seen = new Set();
            for (const doc of docs) {
                let id = null;
                const friendIdx = doc.friendIdx != null ? String(doc.friendIdx) : null;
                const userVal = doc.user != null ? String(doc.user) : null;
                // Ryan is a special case: always map to 'ryan' so we use ryan_top
                if (userVal === 'ryan') {
                    id = 'ryan';
                } else if (friendIdx && /^\d+$/.test(friendIdx)) {
                    id = friendIdx;
                } else if (userVal && /^\d+$/.test(userVal)) {
                    id = userVal;
                } else if (userVal && config.idxMap && config.idxMap[userVal]) {
                    id = config.idxMap[userVal];
                } else if (userVal && getFriendIdxFromOldName && getFriendIdxFromOldName(userVal)) {
                    id = getFriendIdxFromOldName(userVal);
                }
                if (id != null && id !== '' && !seen.has(id)) {
                    seen.add(id);
                    users.push(id);
                }
            }
        } catch (e) {
            console.error('Failed to load users from user_info, falling back to config.users:', e.message);
            users = config.users || [];
        }

        function resolveUserId(user) {
            if (user === 'ryan') return 'ryan';
            if (config.idxMap && config.idxMap[user]) return config.idxMap[user];
            if (getFriendIdxFromOldName && getFriendIdxFromOldName(user)) return getFriendIdxFromOldName(user);
            return user;
        }

        /** Return calendar day YYYY-MM-DD from doc _id (ObjectId has timestamp) so we compare across days, not same-day duplicates. */
        function getCalendarDay(id) {
            if (!id || typeof id.getTimestamp !== 'function') return '';
            const d = id.getTimestamp();
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return y + '-' + m + '-' + day;
        }

        for (let i = 0; i < users.length; i++) {
            await fetchData(users[i]);
        }

        async function fetchData(user) {
            const userId = resolveUserId(user);
            try {
                await client.connect();

                const db = client.db(dbName);

                const collectionName = getTopCollectionName(userId);
                if (!collectionName) {
                    console.error('Unknown user:', user);
                    return;
                }
                console.log(collectionName);
                const collection = db.collection(collectionName);

                // Fetch enough docs to find one from a different calendar day (avoids same-day duplicate scrapes)
                const cursor = collection.find().sort({ _id: -1 }).limit(30);
                const documents = await cursor.toArray();
                const topSongsRecent = documents[0];
                if (!topSongsRecent) {
                    console.error(collectionName, 'missing data');
                    return;
                }
                const recentDay = getCalendarDay(topSongsRecent._id);
                let topSongsOld = null;
                for (let i = 1; i < documents.length; i++) {
                    const day = getCalendarDay(documents[i]._id);
                    if (day !== recentDay) {
                        topSongsOld = documents[i];
                        break;
                    }
                }
                if (!topSongsOld) {
                    console.error(collectionName, 'no document from a different day to compare');
                    return;
                }
                compareSongs(JSON.stringify(topSongsRecent), JSON.stringify(topSongsOld), userId);
            } catch (error) {
                console.error('Error:', error);
            }
        }

        // Normalize values for comparison (handle string/number and whitespace)
        function normalizeRating(rating) {
            if (rating == null) return null;
            const str = String(rating).trim();
            const num = parseFloat(str);
            return isNaN(num) ? str : num;
        }

        function normalizeAchv(achv) {
            if (achv == null) return null;
            return String(achv).trim();
        }

        async function compareSongs(file1, file2, userId) {
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
                    (item) => item.Song === entry.Song && item.Diff === entry.Diff && item.Chart === entry.Chart
                );
                if (correspondingEntry) {
                    // Normalize before comparing to avoid false positives from whitespace/type differences
                    const rating1Norm = normalizeRating(entry.Rating);
                    const rating2Norm = normalizeRating(correspondingEntry.Rating);
                    const achv1Norm = normalizeAchv(entry.Achv);
                    const achv2Norm = normalizeAchv(correspondingEntry.Achv);
                    return (
                        rating1Norm !== rating2Norm ||
                        achv1Norm !== achv2Norm
                    );
                }
                return true;
            });
            const missingInFile2Old = data1.old.filter((entry) => {
                const correspondingEntry = data2.old.find(
                    (item) => item.Song === entry.Song && item.Diff === entry.Diff && item.Chart === entry.Chart
                );
                if (correspondingEntry) {
                    // Normalize before comparing to avoid false positives from whitespace/type differences
                    const rating1Norm = normalizeRating(entry.Rating);
                    const rating2Norm = normalizeRating(correspondingEntry.Rating);
                    const achv1Norm = normalizeAchv(entry.Achv);
                    const achv2Norm = normalizeAchv(correspondingEntry.Achv);
                    return (
                        rating1Norm !== rating2Norm ||
                        achv1Norm !== achv2Norm
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
            const [user_img_src, user_name, user_rating] = await getUserInfo(userId);
            const MAX_FIELDS = 25;

            if (new_records.length === 0) {
                // Special case: always show Ryan's rating even if there are no per-song changes
                if (userId === 'ryan') {
                    const embed = new EmbedBuilder().setColor(0x7289da).setAuthor({
                        name: `${user_name} ${user_rating}rt ${rating_diff_str}`,
                        iconURL: user_img_src,
                    });
                    embed.addFields({
                        name: ' ',
                        value: 'No individual top song changes today.',
                    });
                    channel.send({ embeds: [embed] });
                }
            } else {
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

        async function getUserInfo(userId) {
            try {
                await client.connect();

                const db = client.db(dbName);

                const collection = db.collection('user_info');
                const userKey = userId == null ? '' : String(userId);

                const cursor = collection.find({ user: userKey }).sort({ _id: -1 }).limit(1);
                const documents = await cursor.toArray();
                const document = documents[0];

                if (!document) {
                    console.error('No user_info for', userId);
                    return [null, String(userId), ''];
                }

                const img_src = document.img_src ?? null;
                const name = document.name ?? String(userId);
                const rating = document.rating ?? '';

                return [img_src, name, rating];
            } catch (error) {
                console.error('Error:', error);
                return [null, String(userId), ''];
            }
        }
    },
};

module.exports.runStandalone = async function () {
    const outputs = [];
    const fakeChannel = {
        send: (payload) => {
            try {
                if (payload && Array.isArray(payload.embeds)) {
                    const embeds = payload.embeds.map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e));
                    outputs.push({ embeds });
                } else {
                    outputs.push({ content: payload && payload.content ? payload.content : JSON.stringify(payload) });
                }
            } catch (err) {
                outputs.push({ error: 'failed to serialize payload' });
            }
            return Promise.resolve();
        },
    };

    await module.exports.execute(fakeChannel);
    return outputs;
};
