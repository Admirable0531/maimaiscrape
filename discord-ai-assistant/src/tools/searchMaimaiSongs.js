const { loadSongData } = require('../web/maimaiSongData');

const MAX_RESULTS = 15;

const declaration = {
    name: 'search_maimai_songs',
    description:
        "Search the maimai DX song database for exact chart data: each difficulty's level (including the " +
        'precise decimal internal level, not just the displayed rounded level like "13+"), BPM, artist, ' +
        'category, note designer, and which game version a song was added in. Use this instead of ' +
        "search_web/read_webpage for any question about a specific song's difficulty, level, chart details, " +
        "or release version — it's exact structured data pulled directly from the game data, not something " +
        'read off a wiki page.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Song title or artist name to search for (partial match, case-insensitive).',
            },
            artist: {
                type: 'string',
                description:
                    'Filter to songs by this artist specifically (partial match, case-insensitive) — narrower ' +
                    'than `query`, which also matches titles. Use this for "songs by X" requests where X might ' +
                    'also coincidentally appear in some unrelated title.',
            },
            category: {
                type: 'string',
                description:
                    'Only include songs in this genre category, e.g. "POPS＆アニメ", "niconico＆ボーカロイド", ' +
                    '"東方Project", "ゲーム＆バラエティ", "maimai", "オンゲキ＆CHUNITHM", "宴会場". Matching is ' +
                    'flexible (partial, case-insensitive); if it doesn\'t resolve, the result lists the exact ' +
                    'category names to retry with.',
            },
            note_designer: {
                type: 'string',
                description: "Filter to charts credited to this note designer/chart maker (partial match). \"-\" in the data means uncredited.",
            },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Only include charts of this difficulty.',
            },
            type: {
                type: 'string',
                enum: ['dx', 'std', 'utage'],
                description: 'Only include charts of this type (DX vs standard vs utage).',
            },
            min_level: { type: 'number', description: 'Minimum chart level, numeric (e.g. 12.6 for "12+").' },
            max_level: { type: 'number', description: 'Maximum chart level, numeric.' },
            min_bpm: { type: 'number', description: "Minimum BPM (the song's, not any one chart's)." },
            max_bpm: { type: 'number', description: 'Maximum BPM.' },
            version: {
                type: 'string',
                description:
                    'Only include songs added in this game version, e.g. "PiNK PLUS", "CiRCLE", "BUDDiES PLUS". ' +
                    'Versions come in pairs — a base version (e.g. "PiNK") and its follow-up (e.g. "PiNK PLUS") — ' +
                    'so convert shorthand like "pink+" or "pink plus" to the base name plus "PLUS". Matching is ' +
                    'flexible on case/spacing/"+" vs "plus", so pass your best guess; if it doesn\'t resolve, the ' +
                    'result tells you the full list of valid version names to retry with.',
            },
            random: {
                type: 'boolean',
                description:
                    'Instead of listing matches, pick one uniformly at random from everything matching the other ' +
                    'filters. Use this for "give me a random song/chart to practice" style requests — e.g. ' +
                    'random: true with difficulty "master" and min_level 13 for "give me a random 13+ master".',
            },
        },
    },
};

function normalize(s) {
    return (s || '').toLowerCase();
}

/** "pink+", "PiNK PLUS", "pink plus" all collapse to the same key, so free-text version input matches the canonical name. */
function normalizeVersion(v) {
    return (v || '')
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Resolves a free-text version guess to one of the game's actual version
 * names. Exact match after normalization first; falls back to a substring
 * match only when it's unambiguous. Returns candidates (or the full list)
 * on failure so the caller can retry with a corrected value instead of
 * silently getting zero results.
 */
function resolveVersion(rawVersion, allVersions) {
    const target = normalizeVersion(rawVersion);
    const exact = allVersions.find((v) => normalizeVersion(v) === target);
    if (exact) return { resolved: exact };

    const partial = allVersions.filter(
        (v) => normalizeVersion(v).includes(target) || target.includes(normalizeVersion(v))
    );
    return { resolved: partial.length === 1 ? partial[0] : null, candidates: partial.length > 0 ? partial : allVersions };
}

/** Same shape as resolveVersion, for the (shorter, less ambiguous) category list — no "+"/"plus" normalization needed. */
function resolveCategory(rawCategory, allCategories) {
    const target = normalize(rawCategory).trim();
    const exact = allCategories.find((c) => normalize(c) === target);
    if (exact) return { resolved: exact };

    const partial = allCategories.filter((c) => normalize(c).includes(target) || target.includes(normalize(c)));
    return {
        resolved: partial.length === 1 ? partial[0] : null,
        candidates: partial.length > 0 ? partial : allCategories,
    };
}

async function execute(args) {
    const query = typeof args?.query === 'string' ? normalize(args.query.trim()) : '';
    const artist = typeof args?.artist === 'string' ? normalize(args.artist.trim()) : '';
    const noteDesigner = typeof args?.note_designer === 'string' ? normalize(args.note_designer.trim()) : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : null;
    const type = typeof args?.type === 'string' ? args.type.toLowerCase() : null;
    const minLevel = typeof args?.min_level === 'number' ? args.min_level : null;
    const maxLevel = typeof args?.max_level === 'number' ? args.max_level : null;
    const minBpm = typeof args?.min_bpm === 'number' ? args.min_bpm : null;
    const maxBpm = typeof args?.max_bpm === 'number' ? args.max_bpm : null;
    const random = args?.random === true;
    const hasSheetFilter = Boolean(difficulty || type || minLevel !== null || maxLevel !== null || noteDesigner);

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    let resolvedVersion = null;
    if (typeof args?.version === 'string' && args.version.trim()) {
        const allVersions = data.versions.map((v) => v.version);
        const { resolved, candidates } = resolveVersion(args.version, allVersions);
        if (!resolved) {
            return {
                success: false,
                error: `Could not match "${args.version}" to a known game version.`,
                known_versions: candidates,
            };
        }
        resolvedVersion = resolved;
    }

    let resolvedCategory = null;
    if (typeof args?.category === 'string' && args.category.trim()) {
        const allCategories = data.categories.map((c) => c.category);
        const { resolved, candidates } = resolveCategory(args.category, allCategories);
        if (!resolved) {
            return {
                success: false,
                error: `Could not match "${args.category}" to a known category.`,
                known_categories: candidates,
            };
        }
        resolvedCategory = resolved;
    }

    // Collected without an early cutoff so `random` picks uniformly across
    // every real match, not just whichever happened to appear first in the
    // source data — truncation to MAX_RESULTS (when not random) happens
    // after the full scan instead.
    const matches = [];
    for (const song of data.songs) {
        if (query && !normalize(song.title).includes(query) && !normalize(song.artist).includes(query)) continue;
        if (artist && !normalize(song.artist).includes(artist)) continue;
        if (resolvedVersion && song.version !== resolvedVersion) continue;
        if (resolvedCategory && song.category !== resolvedCategory) continue;
        if (minBpm !== null && (song.bpm == null || song.bpm < minBpm)) continue;
        if (maxBpm !== null && (song.bpm == null || song.bpm > maxBpm)) continue;

        const matchingSheets = song.sheets.filter((sheet) => {
            if (difficulty && sheet.difficulty !== difficulty) return false;
            if (type && sheet.type !== type) return false;
            if (noteDesigner && !normalize(sheet.noteDesigner).includes(noteDesigner)) return false;
            const level = sheet.internalLevelValue ?? sheet.levelValue;
            if (minLevel !== null && level < minLevel) return false;
            if (maxLevel !== null && level > maxLevel) return false;
            return true;
        });
        if (hasSheetFilter && matchingSheets.length === 0) continue;

        matches.push({
            title: song.title,
            artist: song.artist,
            category: song.category,
            bpm: song.bpm,
            version: song.version,
            releaseDate: song.releaseDate,
            charts: (hasSheetFilter ? matchingSheets : song.sheets).map((sheet) => ({
                type: sheet.type,
                difficulty: sheet.difficulty,
                level: sheet.level,
                internalLevel: sheet.internalLevel,
                noteDesigner: sheet.noteDesigner,
            })),
        });
    }

    if (random) {
        if (matches.length === 0) {
            return { success: true, result_count: 0, songs: [], data_updated_at: data.updateTime };
        }
        const pick = matches[Math.floor(Math.random() * matches.length)];
        return { success: true, result_count: 1, picked_from: matches.length, songs: [pick], data_updated_at: data.updateTime };
    }

    return {
        success: true,
        result_count: Math.min(matches.length, MAX_RESULTS),
        truncated: matches.length > MAX_RESULTS,
        songs: matches.slice(0, MAX_RESULTS),
        data_updated_at: data.updateTime,
    };
}

module.exports = { declaration, execute };
