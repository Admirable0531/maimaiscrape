// maimai DX Rating formula, from github.com/myjian/mai-tools's own source
// (src/common/rank-functions.ts + rating-functions.ts) — the same
// community tool already trusted elsewhere in this project (see
// maimaiScoreMath.js for the achievement-rate formula from the same repo).
//
// Per-chart rating = internalLevel x min(achv, 100.5) x rankFactor(achv),
// floored. Most rank brackets use one factor throughout; five brackets
// (SSS, SS+, S+, AAA, BBB) have a slightly higher factor that only applies
// at the exact top edge of that bracket (e.g. exactly 100.4999% within the
// SSS bracket) — replicated here exactly as upstream, even though real
// 4-decimal achievement values will only hit that edge deliberately.
//
// Not included here (upstream's own caveat): the +1 rating point bonus for
// an All Perfect clear — that only applies when summing a player's best-N
// chart ratings into their overall profile rating, not to a single chart's
// rating in isolation.
const RANK_DEFINITIONS = [
    { minAchv: 100.5, factor: 0.224, title: 'SSS+' },
    { minAchv: 100.0, factor: 0.216, title: 'SSS', maxAchv: 100.4999, maxFactor: 0.222 },
    { minAchv: 99.5, factor: 0.211, title: 'SS+', maxAchv: 99.9999, maxFactor: 0.214 },
    { minAchv: 99.0, factor: 0.208, title: 'SS' },
    { minAchv: 98.0, factor: 0.203, title: 'S+', maxAchv: 98.9999, maxFactor: 0.206 },
    { minAchv: 97.0, factor: 0.2, title: 'S' },
    { minAchv: 94.0, factor: 0.168, title: 'AAA', maxAchv: 96.9999, maxFactor: 0.176 },
    { minAchv: 90.0, factor: 0.152, title: 'AA' },
    { minAchv: 80.0, factor: 0.136, title: 'A' },
    { minAchv: 75.0, factor: 0.12, title: 'BBB', maxAchv: 79.9999, maxFactor: 0.128 },
    { minAchv: 70.0, factor: 0.112, title: 'BB' },
    { minAchv: 60.0, factor: 0.096, title: 'B' },
    { minAchv: 50.0, factor: 0.08, title: 'C' },
    { minAchv: 0.0, factor: 0.016, title: 'D' },
];
const RATING_CAP_ACHV = 100.5; // achieving beyond this doesn't raise rating further

function getRankByAchievement(achv) {
    return RANK_DEFINITIONS.find((rank) => achv >= rank.minAchv) || null;
}

/** Per-chart rating for a given internal level + achievement %. Does not include the AP bonus point (see file header). */
function getSongRating(level, achv) {
    const cappedAchv = Math.min(achv, RATING_CAP_ACHV);
    const rank = getRankByAchievement(cappedAchv);
    if (!rank) return null;

    if (rank.maxAchv && rank.maxFactor && rank.maxAchv === achv) {
        return { rating: Math.floor(level * rank.maxAchv * rank.maxFactor), rank: rank.title };
    }
    return { rating: Math.floor(level * cappedAchv * rank.factor), rank: rank.title };
}

/**
 * Minimum achievement % needed on a chart of this level to reach
 * targetRating — walks brackets from lowest to highest and stops at the
 * first one whose own ceiling can reach the target, which is provably the
 * cheapest (lowest-achievement) bracket capable of it, since both the rank
 * factor and the achievement ceiling rise monotonically with rank.
 *
 * Deliberately ignores the 5 special maxFactor edges from getSongRating
 * (SSS/SS+/S+/AAA/BBB's razor-thin higher-factor sliver at their exact top
 * achievement) — inverting through that discontinuity correctly is real
 * extra complexity for a target that's a 0.0001%-wide point nobody's
 * realistically aiming for. This can make the reported answer up to ~0.01%
 * more conservative than the mathematical minimum in those five brackets
 * specifically — negligible for a "what score do I need" answer.
 */
function findMinAchvForRating(level, targetRating) {
    const ranksLowToHigh = [...RANK_DEFINITIONS].sort((a, b) => a.minAchv - b.minAchv);
    for (let i = 0; i < ranksLowToHigh.length; i++) {
        const rank = ranksLowToHigh[i];
        const nextMinAchv = i + 1 < ranksLowToHigh.length ? ranksLowToHigh[i + 1].minAchv : RATING_CAP_ACHV;
        const bracketTopAchv = Math.min(nextMinAchv, RATING_CAP_ACHV);
        const maxRatingInBracket = Math.floor(level * bracketTopAchv * rank.factor);

        if (maxRatingInBracket >= targetRating) {
            const achvNeeded = targetRating / (level * rank.factor);
            const clamped = Math.min(Math.max(achvNeeded, rank.minAchv), bracketTopAchv);
            const rounded = Math.ceil(clamped * 10000) / 10000; // achievement has 4 decimal precision in-game
            return { achv_needed: rounded, rank: rank.title };
        }
    }
    return null; // not reachable even at 100.5%
}

module.exports = { RANK_DEFINITIONS, RATING_CAP_ACHV, getRankByAchievement, getSongRating, findMinAchvForRating };
