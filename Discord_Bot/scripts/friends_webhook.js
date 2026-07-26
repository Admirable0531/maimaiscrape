const config = require('../config');
const { getDb, closeMongo } = require('../lib/mongo');
const { sendToWebhook } = require('../lib/webhook');
const { withMaimaiSession, delay } = require('../lib/maimai_session');
const { getCalendarDayUTC, parseRatingToNumber, chunkLines, safeName } = require('../lib/format');

const LABEL = 'friends';
const FRIEND_LIST_URL = 'https://maimaidx-eng.com/maimai-mobile/friend/';

/** Reads every friend block on the current friend-list page. */
function collectFriendsFromCurrentPage(page) {
    return page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll('div.see_through_block'));
        const results = [];
        for (const block of blocks) {
            const basic = block.querySelector('.basic_block') || block;
            const img = basic.querySelector('img.w_112.f_l');
            const nameEl = basic.querySelector('.name_block.t_l.f_l.f_16.underline, .name_block.underline');
            const ratingEl = basic.querySelector('.rating_block');

            // idx lives in a hidden input inside the friendDetail form
            const detailForm = basic.querySelector('form[action*="/friend/friendDetail/"]');
            const idxInput =
                (detailForm && detailForm.querySelector('input[name="idx"]')) ||
                basic.querySelector('input[name="idx"]');
            const idx = idxInput && idxInput.value ? idxInput.value.trim() : null;

            const name = nameEl ? nameEl.textContent.trim() : '';
            const ratingText = ratingEl ? ratingEl.textContent.trim() : '';
            const imgSrc = img ? img.getAttribute('src') || img.src || null : null;

            if (idx || name || ratingText) {
                results.push({ idx, name, rating: ratingText, img_src: imgSrc });
            }
        }
        return results;
    });
}

/** Reads the "page N /M" pager. */
function getFriendPaginationInfo(page) {
    return page.evaluate(() => {
        const wrapper = document.querySelector('div.d_i.v_t.white');
        if (!wrapper) return { current: 1, total: 1, raw: null };

        const idxInput = wrapper.querySelector('input[name="idx"]');
        const rawDiv = wrapper.querySelector('div.d_ib.m_5.p_t_10.v_t');
        const current = idxInput ? parseInt(idxInput.value, 10) || 1 : 1;

        let total = 1;
        let raw = null;
        if (rawDiv) {
            raw = (rawDiv.textContent || '').trim(); // e.g. "/5"
            const m = raw.match(/(\d+)/);
            if (m) total = parseInt(m[1], 10);
        }
        return { current, total, raw };
    });
}

/** Clicks the btn_next image button. Returns false when there is no next page. */
function goToNextFriendPage(page) {
    return page.evaluate(() => {
        const form =
            document.querySelector('body > div.wrapper.main_wrapper.t_c > form') ||
            document.querySelector('div.wrapper form') ||
            document.querySelector('form');
        if (!form) return false;
        const nextImg = form.querySelector('img[src*="btn_next"]');
        const btn = nextImg && nextImg.closest('button');
        if (!btn) return false;
        btn.click();
        return true;
    });
}

/** Walks every page of the friend list, de-duplicating by friend idx. */
async function scrapeAllFriends(page, maxPages = 50) {
    const all = [];
    const seenIdx = new Set();

    for (let i = 0; i < maxPages; i++) {
        await page.waitForSelector('body', { visible: true, timeout: 60000 });
        const pageInfo = await getFriendPaginationInfo(page);
        console.log(`[${LABEL}] scraping friend page ${pageInfo.current}/${pageInfo.total} (raw ${pageInfo.raw})`);

        const onPage = await collectFriendsFromCurrentPage(page);
        if (onPage.length === 0 && i > 0) break;

        for (const friend of onPage) {
            // Guard against the pager silently re-serving a page we already read.
            if (friend.idx && seenIdx.has(friend.idx)) continue;
            if (friend.idx) seenIdx.add(friend.idx);
            all.push(friend);
        }

        if (!pageInfo.total || pageInfo.current >= pageInfo.total) break;
        if (!(await goToNextFriendPage(page))) break;
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch {
            break;
        }
        await delay(300);
    }
    return all;
}

function getSnapshotCollectionName(accountType) {
    return accountType === 'main' ? 'friend_rating_daily_snapshots_main' : 'friend_rating_daily_snapshots';
}

function getAccountCredentials(accountType) {
    const sid =
        accountType === 'main' ? config.MAIMAI_ACCOUNT_RATING_MAIN : config.MAIMAI_ACCOUNT_RATING_FY;
    return { sid: sid || '', password: config.MAIMAI_PASSWORD_RATING || '' };
}

/** Stores one document per calendar day, replacing any existing one for that day. */
async function saveFriendRatingsSnapshot(friends, accountType = 'fy') {
    if (!friends || friends.length === 0) return false;

    const mappedFriends = friends
        .filter(Boolean)
        .map((f) => ({
            friendIdx: f.idx ?? null,
            name: f.name || '',
            rating: parseRatingToNumber(f.rating),
        }))
        .filter((f) => f.friendIdx && f.rating != null);

    if (mappedFriends.length === 0) {
        console.error(`[${LABEL}][save] snapshot has no valid ratings; skipping save`);
        return false;
    }

    const snapshotDate = getCalendarDayUTC();
    const db = await getDb();
    const col = db.collection(getSnapshotCollectionName(accountType));

    await col.replaceOne(
        { snapshotDate },
        { snapshotDate, friends: mappedFriends, scrapedAt: new Date() },
        { upsert: true }
    );

    console.log(`[${LABEL}][save] saved ${mappedFriends.length} friends for ${snapshotDate} (${accountType})`);
    return true;
}

function buildEmbedsForAccount(account, friends) {
    if (!friends || friends.length === 0) {
        return [
            {
                title: `Friend list for ${account.label || account.sid}`,
                description: 'No friends found or failed to scrape.',
                color: 0xff0000,
            },
        ];
    }

    const sorted = friends
        .map((f) => ({ ...f, ratingNum: parseRatingToNumber(f.rating) }))
        .sort((a, b) => (b.ratingNum ?? -Infinity) - (a.ratingNum ?? -Infinity));

    const lines = sorted.map((f, i) => {
        const rank = String(i + 1).padStart(2, '0');
        const ratingStr = f.rating || (f.ratingNum != null ? `${f.ratingNum} rt` : 'N/A');
        return `\`${rank}.\` **${safeName(f.name)}** — ${ratingStr}`;
    });

    return chunkLines(lines, 4000).map((desc, idx) => ({
        title: idx === 0 ? 'Rating rankings for FY group' : `Friend ratings (cont. ${idx + 1})`,
        description: desc,
        color: 0x7289da,
    }));
}

async function run(opts = {}) {
    const sendWebhook =
        opts.sendWebhook ?? ['1', 'true', 'TRUE'].includes(process.env.SEND_FRIEND_WEBHOOK);
    const doSave = opts.saveToMongo ?? true;
    const accountType = opts.accountType === 'main' ? 'main' : 'fy';
    const webhookType = opts.webhookType === 'test' ? 'test' : 'fy';
    const webhookUrl = webhookType === 'test' ? config.FRIEND_WEBHOOK_URL_TEST : config.FRIEND_WEBHOOK_URL_FY;

    const credentials = getAccountCredentials(accountType);
    if (!credentials.sid || !credentials.password) {
        console.error(
            `[${LABEL}] missing credentials for accountType="${accountType}". ` +
                `Set MAIMAI_ACCOUNT_RATING_${accountType.toUpperCase()} and MAIMAI_PASSWORD_RATING in .env.`
        );
        return { ok: false, error: 'missing credentials' };
    }

    const account = { ...credentials, label: accountType === 'main' ? 'MAIN' : 'FY' };

    try {
        const friends = await withMaimaiSession({
            credentials,
            label: LABEL,
            fallback: [],
            task: async (page, _browser, { shot }) => {
                await page.goto(FRIEND_LIST_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                await shot(page, '07_friend_page');
                return scrapeAllFriends(page);
            },
        });

        console.log(`[${LABEL}] collected ${friends.length} entries for ${account.label}`);

        if (friends.length === 0) {
            return { ok: false, error: 'no friends scraped', friendsCount: 0 };
        }
        if (doSave) {
            await saveFriendRatingsSnapshot(friends, accountType);
        }
        if (sendWebhook) {
            await sendToWebhook(webhookUrl, buildEmbedsForAccount(account, friends), LABEL);
        }
        return { ok: true, friendsCount: friends.length };
    } catch (err) {
        console.error(`[${LABEL}] error processing account ${account.label}:`, err);
        return { ok: false, error: String(err) };
    }
}

if (require.main === module) {
    run()
        .then((result) => {
            console.log(`[${LABEL}] completed:`, result);
            return closeMongo();
        })
        .then(() => process.exit(0))
        .catch(async (err) => {
            console.error(err);
            await closeMongo().catch(() => {});
            process.exit(1);
        });
}

module.exports = { run };
