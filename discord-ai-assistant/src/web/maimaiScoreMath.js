// maimai DX achievement-rate scoring, from the actual constants in
// github.com/myjian/mai-tools (src/classic-layout/constants.ts +
// src/dx-achievement/finaleBacktracing.ts) — the same community tool
// Discord_Bot's /constant command already injects into the live game page.
// Validated live against two independently known-correct AP percentages
// (Galaxy Blaster 100.9929%, FLAME/FROST 100.9897%) before shipping this.
const BASE_SCORE_PER_TYPE = { tap: 500, hold: 1000, touch: 500, slide: 1500, break: 2500 };
const REGULAR_TYPES = ['tap', 'hold', 'slide', 'touch'];

// A break note's judgment maps to one of these 8 point values. All three
// "perfect" tiers (2600/2550/2500) give FULL base-score credit — they only
// differ in how much of the separate 1%-of-achievement break bonus pool
// they earn. This is why any true AP (no note below Perfect) always scores
// exactly 100.0000% base, regardless of which perfect sub-tier each break
// landed on — only the bonus varies.
const BREAK_TIERS = [
    { key: 2600, base: 1, bonus: 1, label: 'Critical Perfect' },
    { key: 2550, base: 1, bonus: 0.75, label: 'Perfect (high window)' },
    { key: 2500, base: 1, bonus: 0.5, label: 'Perfect (low window)' },
    { key: 2000, base: 0.8, bonus: 0.4, label: 'Great (high)' },
    { key: 1500, base: 0.6, bonus: 0.4, label: 'Great (mid)' },
    { key: 1250, base: 0.5, bonus: 0.4, label: 'Great (low)' },
    { key: 1000, base: 0.4, bonus: 0.3, label: 'Good' },
    { key: 0, base: 0, bonus: 0, label: 'Miss' },
];
// Index 0-2 are the "still counts as Perfect-or-better" tiers an AP allows.
const AP_TIER_COUNT = 3;

function totalBaseScore(noteCounts) {
    return (
        REGULAR_TYPES.reduce((sum, t) => sum + (noteCounts[t] || 0) * BASE_SCORE_PER_TYPE[t], 0) +
        (noteCounts.break || 0) * BASE_SCORE_PER_TYPE.break
    );
}

// maimai DX NET floor-truncates the displayed percentage to 4 decimals
// (confirmed via mai-tools' roundFloat(..., 'floor', 0.0001)) — it does NOT
// round. So a displayed value of e.g. 100.9929% corresponds to a true value
// anywhere in [100.9929, 100.9930).
function truncationWindow(targetPercent) {
    return [targetPercent, targetPercent + 0.0001];
}

/**
 * Checks whether targetPercent is achievable as a pure AP (every note
 * Perfect-or-better — no Great/Good/Miss anywhere) on a chart with these
 * note counts. Only the break tier distribution matters, since regular
 * notes and break-base score are always maxed in any AP. Searches all
 * (numCriticalPerfect, numHighPerfect) pairs — O(breakCount²), a few
 * thousand iterations even for the densest real charts, nowhere near
 * "brute force over per-note judgments."
 *
 * Returns { cp, hp, lp, exactPercent, minApPercent, maxApPercent } for the
 * first matching breakdown, or null if no AP lands in the truncation window
 * (either because it's mathematically outside the chart's possible AP range,
 * or because it doesn't land on the achievable step grid).
 */
function findApBreakdown(noteCounts, targetPercent) {
    const breakCount = noteCounts.break || 0;
    const maxApPercent = 101; // all breaks Critical Perfect
    const minApPercent = breakCount === 0 ? 100 : 100.5; // all breaks at the lowest Perfect-tier — the 0.5 weight is per-break, so it doesn't depend on how many there are

    if (breakCount === 0) {
        return Math.abs(targetPercent - 100) < 0.00005
            ? { cp: 0, hp: 0, lp: 0, exactPercent: 100, minApPercent: 100, maxApPercent: 100 }
            : null;
    }

    const [loRaw, hiRaw] = truncationWindow(targetPercent);
    const lo = loRaw - 100;
    const hi = hiRaw - 100;

    for (let cp = breakCount; cp >= 0; cp--) {
        const hpMax = breakCount - cp;
        for (let hp = hpMax; hp >= 0; hp--) {
            const lp = breakCount - cp - hp;
            const bonusPct = (cp * 1 + hp * 0.75 + lp * 0.5) / breakCount;
            if (bonusPct >= lo && bonusPct < hi) {
                return { cp, hp, lp, exactPercent: 100 + bonusPct, minApPercent, maxApPercent };
            }
        }
    }
    return null;
}

module.exports = { BASE_SCORE_PER_TYPE, BREAK_TIERS, AP_TIER_COUNT, totalBaseScore, truncationWindow, findApBreakdown };
