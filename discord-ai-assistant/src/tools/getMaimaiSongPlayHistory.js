const cheerio = require('cheerio');
const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadSongData } = require('../web/maimaiSongData');
const { findSongInLocalData, findPlayedSongIdx } = require('../web/maimaiSongIndex');

const declaration = {
    name: 'get_maimai_song_play_history',
    description:
        "Look up this tracked account's per-difficulty play count, last-played date, best achievement %, and " +
        'real clear-type badges for one specific song, by name — is_ap/is_ap_plus, is_fc/is_fc_plus, is_fs/' +
        'is_fs_plus/is_fsd (Full Sync tiers), is_sync, plus the raw badges array (every badge icon this play ' +
        'actually has, in case something isn\'t covered by those flags). Read directly off the actual badge ' +
        "icons, not guessed from the percentage — this is the only reliable way to know if a specific play was " +
        "truly an AP: a percentage in the AP-range does NOT prove it was one (a non-Perfect regular-note " +
        'judgment can cost less than the break bonus adds back, landing a non-AP play in that same range), so ' +
        'always check is_ap here rather than inferring AP status from achievement_percent alone, for this ' +
        "tracked account. It only finds a chart the account has actually played at least once.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'The song title to look up (partial match is fine).' },
        },
        required: ['song_name'],
    },
};

// Confirmed live: each difficulty's play, if any, shows a row of badge icons
// (e.g. music_icon_ap.png, music_icon_fc.png, music_icon_sync.png) — these
// are the game's own real clear-type indicators, unlike the achievement %
// alone, which cannot distinguish an AP from a high-percentage non-AP play.
// AP+'s exact icon filename wasn't independently confirmed live this
// session (no AP+ play was available to check against) — inferred from the
// well-known "ap"/"app" naming pattern used by the other tiered badges
// (fc/fcp, fs/fsp, fsd/fsdp) seen live. Raw badge codes are always returned
// too, so this guess doesn't hide the real underlying data if it's wrong.
function parseDifficultyBlocks(html) {
    const $ = cheerio.load(html);
    const blocks = [];
    $('[class*="_score_back"]').each((_, el) => {
        const $block = $(el);
        const badges = $block
            .find('img')
            .toArray()
            .map((img) => {
                const src = $(img).attr('src') || '';
                const file = src.split('/').pop() || '';
                return file.replace(/^music_icon_/, '').replace(/\.png.*$/, '');
            })
            .filter(Boolean);

        const text = $block.text().replace(/\s+/g, ' ').trim();
        const levelMatch = /^([\d.+]+)/.exec(text);
        const dateMatch = /Last played date：\s*([\d/: ]+\d)/.exec(text);
        const playCountMatch = /PLAY COUNT：\s*(\d+)/.exec(text);
        const achvMatch = /([\d]+\.\d+)%/.exec(text);

        // is_ap/is_fc/is_sync are confirmed live (ap, fc, fcp, sync all
        // observed in real play data this session). is_fc_plus and the FS-
        // tier flags (fs/fsp/fsd/fsdp) follow the same naming pattern but
        // weren't independently confirmed live — no false negative either
        // way though, since the raw `badges` array always has every icon
        // this block actually had, whether or not a flag below catches it.
        const has = (code) => badges.includes(code);
        blocks.push({
            difficulty: $block.attr('id') || null,
            level: levelMatch ? levelMatch[1] : null,
            last_played_date: dateMatch ? dateMatch[1].trim() : null,
            play_count: playCountMatch ? Number(playCountMatch[1]) : null,
            achievement_percent: achvMatch ? Number(achvMatch[1]) : null,
            badges,
            is_ap: has('ap') || has('app'),
            is_ap_plus: has('app'),
            is_fc: has('fc') || has('fcp'),
            is_fc_plus: has('fcp'),
            is_fs: has('fs') || has('fsp') || has('fsd') || has('fsdp'),
            is_fs_plus: has('fsp') || has('fsdp'),
            is_fsd: has('fsd') || has('fsdp'),
            is_sync: has('sync'),
        });
    });
    return blocks;
}

async function execute(args) {
    const songName = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    if (!songName) return { success: false, error: 'song_name is required.' };

    try {
        const songData = await loadSongData();
        const song = findSongInLocalData(songData, songName);
        if (!song) return { success: false, error: `No song matching "${songName}" found.` };
        if (song.ambiguous) {
            return { success: false, error: `Multiple songs match "${songName}" — be more specific.`, matches: song.ambiguous };
        }

        const idx = await findPlayedSongIdx(song);
        if (!idx) {
            return { success: false, error: `"${song.title}" doesn't appear in this account's play history — it hasn't been played (on any difficulty).` };
        }

        const { html: detailHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(idx)}`
        );
        const difficulties = parseDifficultyBlocks(detailHtml);
        if (difficulties.length === 0) {
            return { success: false, error: `Fetched "${song.title}"'s page but couldn't parse any play data from it — the session may have hiccupped, try again.` };
        }

        return {
            success: true,
            song_name: song.title,
            difficulties,
            url: finalUrl,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
