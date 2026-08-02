// Curated from a live, logged-in crawl of maimaidx-eng.com/maimai-mobile/
// (confirmed real page titles/content, not guessed) — see
// src/web/maimaiAccountSession.js for how these get fetched. Deliberately
// excludes: pages that mutate state (friend/circle invites, name change,
// settings), pages that were empty/placeholder for the crawled account,
// pure legal boilerplate, and anything not independently confirmed safe —
// including a couple of paths confirmed live to break the entire login
// session for every page after them (see BLOCKED_PATHS in
// maimaiAccountSession.js), which are not listed here at all.
const CATEGORIES = [
    {
        label: 'Overview',
        pages: [
            { path: '/maimai-mobile/home/', title: 'Home', description: 'Current DX Rating, class/dan badges, event timers, missions, currency.' },
            { path: '/maimai-mobile/playerData/', title: "Player's Data", description: 'Play counts (current version + all-time), maimile currency, missions, owned tickets.' },
            { path: '/maimai-mobile/playerData/stampCard/', title: 'Stamp Card', description: 'Partner-character stamp cards earned via play, grouped by collab edition.' },
        ],
    },
    {
        label: 'Records & rankings',
        pages: [
            { path: '/maimai-mobile/record/', title: 'Game Record', description: 'Recent play log — date/time, difficulty, song title, achievement %, DX score, most recent first. Not a per-song history — use get_maimai_song_play_history for that.' },
            { path: '/maimai-mobile/record/musicMybest/search/?diff=99', title: 'My Best', description: "Every song this account has ever played, with a total play count per song shown directly (the bare /record/musicMybest/ page is just a tab landing with no results). For per-difficulty last-played dates too, use get_maimai_song_play_history instead of reading this page raw." },
            { path: '/maimai-mobile/record/musicLevel/search/', title: 'Song Scores by Level', description: 'Best scores filtered to one difficulty level. Needs a level query param, e.g. "?level=13+".' },
            { path: '/maimai-mobile/record/nationalData/', title: 'World Stats', description: 'Global clear-rate stats (SSS+/SSS/SS/S/AP) by level.' },
            { path: '/maimai-mobile/ranking/deluxeRating/', title: 'DX Rating Ranking', description: "Global (EX) and friend-only leaderboards by DX Rating, this account's own rating shown at top. Real data on load, no filter needed." },
            { path: '/maimai-mobile/ranking/totalAchievement/', title: 'Total Achievement Ranking', description: 'Leaderboard by cumulative achievement %. Real data on load, no filter needed.' },
            { path: '/maimai-mobile/ranking/courseRanking/search/?course=651001&scoreType=2&rankingType=99&diff=0', title: 'Dan Exam Ranking', description: 'Ranking by dan (段位) tier — the bare courseRanking/ page is just an empty filter form; this is a confirmed-working example query (course/scoreType/rankingType/diff) returning real ranked entries. Change the values to explore other tiers.' },
        ],
    },
    {
        label: 'Friends & circle',
        pages: [
            { path: '/maimai-mobile/friend/', title: "All Friend's", description: "This account's full friend list with ratings — friend ratings are read directly off this page, there is no per-friend detail page." },
            { path: '/maimai-mobile/circle/', title: 'Circle', description: "This account's circle name/tag, current month's aggregate total points, and current rank — circle-wide totals only, not per-member. Use Circle Members below for individual contributions." },
            { path: '/maimai-mobile/circle/circleMember/', title: 'Circle Members', description: "Every circle member's name, rating, and their own individual point contribution for the current month." },
        ],
    },
    {
        label: 'Areas & events',
        pages: [
            { path: '/maimai-mobile/map/', title: 'Area', description: 'List of area ("chihou") maps with distance traveled per area.' },
            { path: '/maimai-mobile/map/eventMap/', title: 'Event Area', description: 'Currently active limited-time collab event areas with date ranges.' },
            { path: '/maimai-mobile/map/eventMapLog/', title: 'Event Area (Ended)', description: 'Archive of past event areas.' },
        ],
    },
    {
        label: 'Collection',
        pages: [
            { path: '/maimai-mobile/collection/', title: 'Icon', description: 'Unlocked profile icons, grouped by category (all/favorite/random/default/reward/theme). Each item has a name and how-to-obtain description text, but no acquisition date.' },
            { path: '/maimai-mobile/collection/nameplate/', title: 'Name Plate', description: 'Unlocked nameplates — same per-item name + how-obtained text as Icon, no dates.' },
            { path: '/maimai-mobile/collection/frame/', title: 'Frame', description: 'Unlocked frames — same per-item name + how-obtained text as Icon, no dates. Also shows a favorites count and total frame count.' },
            { path: '/maimai-mobile/collection/trophy/', title: 'Title', description: "Unlocked titles — text-based (styled text, not images), despite the URL saying \"trophy\"." },
            { path: '/maimai-mobile/collection/character/', title: 'Tour Member', description: 'Character roster with per-character level and stats.' },
            { path: '/maimai-mobile/collection/partner/', title: 'Partner', description: 'Partner list with unlock conditions.' },
        ],
    },
    {
        label: 'Shop',
        pages: [
            { path: '/maimai-mobile/shop/', title: 'SHOP', description: 'Maimile currency shop — tickets, partners, tour members, nameplates, frames, with prices and owned balance.' },
        ],
    },
];

const declaration = {
    name: 'list_maimai_account_pages',
    description:
        "List the pages available on this tracked account's own maimai DX NET " +
        '(maimaidx-eng.com/maimai-mobile/...) — its live, authenticated in-game data: current rating, play/score ' +
        'records, world/friend rankings, friend list, circle info, and collection screens (icons, nameplates, ' +
        'frames, titles, characters, partners). This is ONE specific tracked account\'s data, not the asking ' +
        "Discord user's own maimai account — don't imply otherwise. Call this to find the right path, then fetch " +
        'it with read_webpage using the full URL (https://maimaidx-eng.com + path). There is no per-friend detail ' +
        'page — friend ratings come directly off the friend list page.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description:
                    'Optional: only return pages under the category whose label contains this text (partial, ' +
                    'case-insensitive — e.g. "collection" or "records"). Omit to get everything.',
            },
        },
    },
};

async function execute(args) {
    const filter = typeof args?.category === 'string' ? args.category.trim().toLowerCase() : '';
    const filtered = filter ? CATEGORIES.filter((c) => c.label.toLowerCase().includes(filter)) : CATEGORIES;

    if (filter && filtered.length === 0) {
        return {
            success: false,
            error: `No category matched "${args.category}".`,
            known_categories: CATEGORIES.map((c) => c.label),
        };
    }

    const categories = filtered.map((c) => ({
        label: c.label,
        pages: c.pages.map((p) => ({ ...p, url: `https://maimaidx-eng.com${p.path}` })),
    }));

    return { success: true, categories };
}

module.exports = { declaration, execute };
