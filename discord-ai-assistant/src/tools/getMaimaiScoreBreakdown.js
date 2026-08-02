const { loadSongData } = require('../web/maimaiSongData');
const { totalBaseScore, findApBreakdown } = require('../web/maimaiScoreMath');

const declaration = {
    name: 'get_maimai_score_breakdown',
    description:
        'Check whether a specific achievement percentage (e.g. "100.9929%") is achievable as an AP (All Perfect ' +
        '— every note Perfect-or-better, no Great/Good/Miss) on a specific song and difficulty, using the exact ' +
        "note counts and maimai's real scoring formula — not a guess. If it is achievable, returns the exact " +
        'break-judgment breakdown (how many Critical Perfect / high-window Perfect / low-window Perfect) that ' +
        "produces it, plus the chart's full possible AP range (always 100.5000%-101.0000% when it has breaks, " +
        'exactly 100.0000% if it has none). Only checks pure-AP scores — it does NOT solve for scores that ' +
        "include any Great/Good/Miss (a much larger, unsolved search space); if the target isn't a valid AP for " +
        'this chart, say so plainly rather than guessing at a Great/Good/Miss combination.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'Song title (partial match is fine).' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Chart difficulty to check.',
            },
            target_percent: {
                type: 'number',
                description: 'The achievement percentage to check, e.g. 100.9929.',
            },
        },
        required: ['song_name', 'difficulty', 'target_percent'],
    },
};

async function execute(args) {
    const songQuery = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : '';
    const targetPercent = typeof args?.target_percent === 'number' ? args.target_percent : null;

    if (!songQuery) return { success: false, error: 'song_name is required.' };
    if (!difficulty) return { success: false, error: 'difficulty is required.' };
    if (targetPercent === null || Number.isNaN(targetPercent)) return { success: false, error: 'target_percent is required.' };

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    const q = songQuery.toLowerCase();
    const songMatches = data.songs.filter((s) => s.title.toLowerCase().includes(q));
    if (songMatches.length === 0) {
        return { success: false, error: `No song matching "${songQuery}" found.` };
    }
    if (songMatches.length > 1) {
        const exact = songMatches.find((s) => s.title.toLowerCase() === q);
        if (!exact) {
            return {
                success: false,
                error: `Multiple songs match "${songQuery}" — be more specific.`,
                matches: songMatches.slice(0, 10).map((s) => s.title),
            };
        }
        return checkChart(exact, difficulty, targetPercent);
    }

    return checkChart(songMatches[0], difficulty, targetPercent);
}

function checkChart(song, difficulty, targetPercent) {
    const sheet = song.sheets.find((sh) => sh.difficulty === difficulty);
    if (!sheet) {
        return {
            success: false,
            error: `"${song.title}" has no ${difficulty} chart.`,
            available_difficulties: song.sheets.map((sh) => sh.difficulty),
        };
    }
    if (!sheet.noteCounts) {
        return { success: false, error: `No note-count data available for "${song.title}" (${difficulty}).` };
    }

    const noteCounts = sheet.noteCounts;
    const breakdown = findApBreakdown(noteCounts, targetPercent);

    if (!breakdown) {
        const fallbackRange = noteCounts.break > 0 ? { min_ap_percent: 100.5, max_ap_percent: 101 } : { min_ap_percent: 100, max_ap_percent: 100 };
        return {
            success: true,
            song_title: song.title,
            difficulty,
            level: sheet.level,
            internal_level: sheet.internalLevel,
            note_counts: noteCounts,
            target_percent: targetPercent,
            is_achievable_ap: false,
            ...fallbackRange,
            note: 'Not achievable as a pure AP on this chart (either outside the possible AP range, or this exact value does not land on the achievable step grid). This does not rule out a score that includes Great/Good/Miss judgments — that combination space is not searched by this tool.',
        };
    }

    return {
        success: true,
        song_title: song.title,
        difficulty,
        level: sheet.level,
        internal_level: sheet.internalLevel,
        note_counts: noteCounts,
        target_percent: targetPercent,
        is_achievable_ap: true,
        exact_percent: Number(breakdown.exactPercent.toFixed(6)),
        break_breakdown: {
            critical_perfect: breakdown.cp,
            perfect_high_window: breakdown.hp,
            perfect_low_window: breakdown.lp,
            total_breaks: noteCounts.break,
        },
        min_ap_percent: breakdown.minApPercent,
        max_ap_percent: breakdown.maxApPercent,
    };
}

module.exports = { declaration, execute };
