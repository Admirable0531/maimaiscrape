const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../lib/mongo');
const { chunkLines } = require('../../lib/format');
const { sortRankings } = require('../../scripts/circle_ranking_scraper');

const COLLECTION = 'circle_rankings';

function toRankMap(rankings) {
    const map = new Map();
    sortRankings(rankings).forEach((r, index) => map.set(r.groupName, { rank: index + 1, points: r.points }));
    return map;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('latestcirclerankings')
        .setDescription('Show the latest circle rankings from database')
        .addIntegerOption((option) =>
            option
                .setName('limit')
                .setDescription('Number of rankings to show (default: 20, max: 100)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(100)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const limit = interaction.options.getInteger('limit') ?? 20;

        try {
            const collection = (await getDb()).collection(COLLECTION);

            // Two newest snapshots: [0] is what we display, [1] is the baseline.
            const snapshots = await collection.find({}).sort({ scrapedAt: -1 }).limit(2).toArray();
            const latest = snapshots[0];

            if (!latest?.rankings?.length) {
                await interaction.editReply(
                    '❌ No circle rankings found in the database. Run the scraper first with `/circle`.'
                );
                return;
            }

            const previous = snapshots[1] ? toRankMap(snapshots[1].rankings) : null;
            const ranked = sortRankings(latest.rankings);
            const shown = ranked.slice(0, limit);

            const lines = shown.map((ranking, index) => {
                const currentRank = index + 1;
                const rankStr = String(currentRank).padStart(2, '0');

                let changeIndicator = previous ? ' 🆕' : '';
                let pointsChangeIndicator = '';

                const before = previous?.get(ranking.groupName);
                if (before) {
                    const rankChange = before.rank - currentRank;
                    if (rankChange > 0) changeIndicator = ` ⬆️${rankChange}`;
                    else if (rankChange < 0) changeIndicator = ` ⬇️${Math.abs(rankChange)}`;
                    else changeIndicator = ' ➖';

                    const pointsChange = ranking.points - before.points;
                    if (pointsChange !== 0) {
                        pointsChangeIndicator = ` (${pointsChange > 0 ? '+' : ''}${pointsChange.toLocaleString()})`;
                    }
                }

                return `\`${rankStr}.\` **${ranking.groupName}** — ${ranking.points.toLocaleString()} PT${pointsChangeIndicator}${changeIndicator}`;
            });

            const scrapedAt =
                latest.scrapedAt instanceof Date ? latest.scrapedAt.toLocaleString() : String(latest.scrapedAt);
            const footer = {
                text:
                    `Showing ${shown.length} of ${ranked.length} circles • Scraped: ${scrapedAt}` +
                    (previous ? ' • ⬆️⬇️ vs previous snapshot' : ''),
            };

            // A description-per-embed keeps us clear of the 25-field limit and,
            // with chunkLines, of the per-message character cap that 25 inline
            // fields across 10 embeds could otherwise exceed.
            const embeds = chunkLines(lines, 3000, 30).map((description, index) =>
                new EmbedBuilder()
                    .setTitle(index === 0 ? 'Latest Circle Rankings' : `Latest Circle Rankings (cont. ${index + 1})`)
                    .setColor(0x7289da)
                    .setDescription(description)
                    .setFooter(footer)
            );

            await interaction.editReply({ embeds: embeds.slice(0, 10) });
            for (let i = 10; i < embeds.length; i += 10) {
                await interaction.followUp({ embeds: embeds.slice(i, i + 10) });
            }
        } catch (error) {
            console.error('Error fetching circle rankings:', error);
            await interaction.editReply(`❌ Error fetching circle rankings: ${error.message}`);
        }
    },
};
