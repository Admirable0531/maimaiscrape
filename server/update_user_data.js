const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
require('dotenv').config();
const { getTopCollectionName } = require('./collectionNames');

const HEADLESS = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0';
const SCREENSHOT_DEBUG = process.env.SCREENSHOT_DEBUG === '1' || process.env.SCREENSHOT_DEBUG === 'true';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'screenshots');

function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Returns a promise that resolves with the next new page when a target is created (e.g. from a target="_blank" click). Call before the click. */
function waitForNewPage(browser, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            browser.off('targetcreated', handler);
            reject(new Error('Timeout waiting for new page'));
        }, timeoutMs);
        const handler = async (target) => {
            if (target.type() === 'page') {
                clearTimeout(timer);
                browser.off('targetcreated', handler);
                try {
                    const p = await target.page();
                    resolve(p);
                } catch (e) {
                    reject(e);
                }
            }
        };
        browser.on('targetcreated', handler);
    });
}


async function debugScreenshot(page, stepName) {
    if (!SCREENSHOT_DEBUG || !page) return;
    try {
        const dir = SCREENSHOT_DIR;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = path.join(dir, `${stepName}_${ts}.png`);
        await page.screenshot({ path: file });
        console.log(`[screenshot] ${file}`);
    } catch (e) {
        console.log('[screenshot] failed:', e.message);
    }
}

const FALLBACK_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
const ALT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

async function clickVisibleAgreeCheckbox(page) {
    const selector = 'input.c-form__checkbox.js-agree';
    try {
        await delay(200);
        const inputs = await page.$$(selector);
        for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i];
            const box = await el.boundingBox();
            if (!box) continue;
            try {
                await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
            } catch (e) {}
            try {
                await el.click({ delay: 50 });
                console.log(`[agree] clicked visible checkbox (index ${i}) via element.click()`);
                return true;
            } catch (e) {
                try {
                    await page.evaluate((e) => e.click(), el);
                    console.log(`[agree] clicked visible checkbox (index ${i}) via JS click()`);
                    return true;
                } catch (err) {}
            }
        }
    } catch (e) {
        console.log('[agree] error', e);
    }

    try {
        const parent = await page.$('#agree-maimaidxex');
        if (parent) {
            const label = await parent.$('label');
            if (label) {
                try {
                    await label.click();
                    console.log('[agree] clicked label inside #agree-maimaidxex via label.click()');
                    return true;
                } catch (e) {
                    try {
                        await page.evaluate((el) => el.click(), label);
                        console.log('[agree] clicked label inside #agree-maimaidxex via JS click()');
                        return true;
                    } catch (err) {}
                }
            }
        }
    } catch (e) {}

    console.log('[agree] could not find a visible agree checkbox to click');
    return false;
}

async function isErrorPage(page) {
    try {
        const title = (await page.title()) || '';
        if (title.toUpperCase().includes('ERROR')) return true;
        const content = await page.content();
        if (content.includes('Aime service site') && content.includes('Error')) return true;
        if (content.includes('Please enable JavaScript and CSS')) return true;
        const errEl = await page.$('#error-ui');
        if (errEl) return true;
    } catch (e) {}
    return false;
}

const TOP_RECORD_TABLE_TIMEOUT = parseInt(process.env.TOP_RECORD_TABLE_TIMEOUT || '120000', 10);
const TOP_RECORD_POLL_MS = parseInt(process.env.TOP_RECORD_POLL_MS || '2000', 10);

/** Wait for SEGA top-record page: poll every few seconds; exit as soon as table appears (no full timeout once loaded). */
async function waitForTopRecordPageReady(page) {
    const tableSelector = '.topRecordTable.songRecordTable';
    const loadingPattern = 'Loading\\s+(?:Re:?Master|Basic|Master|Expert|Advanced|recent)\\s+scores';
    const deadline = Date.now() + TOP_RECORD_TABLE_TIMEOUT;
    let lastLoading = '';
    while (Date.now() < deadline) {
        const { table, loading } = await page.evaluate((sel, pattern) => {
            const table = !!document.querySelector(sel);
            const body = (document.body && document.body.innerText) ? document.body.innerText : '';
            const re = new RegExp(pattern, 'i');
            const m = body.match(re);
            const loading = m ? m[0] : (body.includes('Loading') ? 'Loading…' : '');
            return { table, loading };
        }, tableSelector, loadingPattern);
        if (table) return;
        if (loading && loading !== lastLoading) {
            lastLoading = loading;
            console.log('[update] top-record:', loading);
        }
        await delay(TOP_RECORD_POLL_MS);
    }
    await page.waitForSelector(tableSelector, { timeout: 1000 });
}

async function getTopScore(page) {
    await waitForTopRecordPageReady(page);
    const data = await page.evaluate(() => {
        function parseTable(table) {
            const rows = Array.from(table.querySelectorAll('tr.scoreRecordRow'));
            const out = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const classes = Array.from(row.classList || []);
                const diff = classes.length > 1 ? classes[1] : '';
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 7) continue;
                out.push({
                    '#': cells[0].textContent.trim(),
                    Song: cells[1].textContent.trim(),
                    Chart: cells[2].textContent.trim(),
                    Level: cells[3].textContent.trim(),
                    Achv: cells[4].textContent.trim(),
                    Rank: cells[5].textContent.trim(),
                    Rating: cells[6].textContent.trim(),
                    Diff: diff,
                });
            }
            return out;
        }

        const tables = Array.from(document.querySelectorAll('.topRecordTable.songRecordTable'));
        const newTbl = tables[0] ? parseTable(tables[0]) : [];
        const oldTbl = tables[1] ? parseTable(tables[1]) : [];
        const ratingEl = document.querySelector('.totalRating');
        let rating = null;
        if (ratingEl) {
            const txt = ratingEl.textContent || '';
            if (txt.includes('：')) {
                const parts = txt.split('：');
                rating = parseInt(parts[1].trim()) || null;
            } else {
                const m = txt.match(/(\d+)/);
                rating = m ? parseInt(m[1]) : null;
            }
        }
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return { new: newTbl, old: oldTbl, rating, Date: dateStr };
    });
    return data;
}

async function getRyanInfo(page, db, formattedDate) {
    await page.waitForSelector('.w_112.f_l', { visible: true, timeout: 60000 });
    // Friends' extraction already falls back to the resolved `.src` (see
    // collectPageFriends below) for pages where getAttribute('src') is
    // relative or briefly empty pre-hydration — this path was missing that
    // fallback, which would silently store a bad/empty img_src with no
    // error anywhere in the pipeline.
    const user_img_src = await page.$eval('.w_112.f_l', (el) => el.getAttribute('src') || el.src || null);
    const user_name = await page.$eval('.name_block.f_l.f_16', (el) => el.textContent.trim());
    const user_rating = await page.$eval('.rating_block', (el) => el.textContent.trim());
    const ryan_user_data = {
        user: 'ryan',
        img_src: user_img_src,
        name: user_name,
        rating: user_rating,
        date: formattedDate,
    };
    await db.collection('user_info').insertOne(ryan_user_data);
    console.log('[get_ryan_info] inserted ryan user_info');
}

/** Insert user_info for friends; each entry has friendIdx (from link) and name/img_src/rating from the same block. */
async function insertFriendUserInfo(db, formattedDate, friends) {
    for (const f of friends) {
        if (!f.friendIdx) continue;
        try {
            const user_data = {
                user: f.friendIdx,
                friendIdx: f.friendIdx,
                img_src: f.img_src || null,
                name: f.name || '',
                rating: f.rating || '',
                date: formattedDate,
            };
            await db.collection('user_info').insertOne(user_data);
            console.log(`[get_user_info] inserted friendIdx ${f.friendIdx}`);
        } catch (err) {
            console.log(`[get_user_info] error for friendIdx ${f.friendIdx}:`, err.message);
        }
    }
}

async function updateUserData() {
    const login_user = process.env.MAIMAI_USER || '';
    const login_pass = process.env.MAIMAI_PASS || '';
    const user_agent_env = (process.env.USER_AGENT || '').trim();
    const user_agent = user_agent_env || FALLBACK_UA;
    const attempts = [user_agent, ALT_UA];

    // On Raspberry Pi / ARM, use system Chromium if present (Puppeteer's download is x86 only)
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!executablePath && process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64')) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    if (executablePath) {
        console.log('[update] using browser:', executablePath);
    } else if (process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64')) {
        console.log('[update] no system Chromium found. On ARM the bundled browser is x86 and will fail. Install like Docker does: sudo apt install chromium');
    }

    if (!HEADLESS) console.log('[update] Running with visible browser (HEADLESS=false). Use SSH -X to see it on your machine.');
    if (SCREENSHOT_DEBUG) console.log('[update] Screenshot debug on: saving to', SCREENSHOT_DIR);

    console.log('[update] starting update');
    for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
        const ua = attempts[attemptIdx];
        console.log(`[attempt ${attemptIdx + 1}] using UA: ${ua}`);
        // Declared per attempt and closed in `finally`, so a throw can't leak
        // either the browser or the Mongo connection.
        let browser = null;
        let client = null;
        try {
            browser = await puppeteer.launch({
                headless: HEADLESS,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                defaultViewport: HEADLESS ? { width: 1280, height: 1024 } : null,
                ...(executablePath ? { executablePath } : {}),
            });
            const page = await browser.newPage();
            if (HEADLESS) await page.setViewport({ width: 1280, height: 1024 });
            await page.setUserAgent(ua);
            await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

            await page.goto('https://maimaidx-eng.com', { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('[update] page loaded');
            await debugScreenshot(page, '01_home');

            // click Sega login button if present
            try {
                const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                if (segaBtn) {
                    console.log('[update] clicking sega login button');
                    await segaBtn.click();
                    await clickVisibleAgreeCheckbox(page);
                    await delay(500 + Math.random() * 1000);
                    await debugScreenshot(page, '02_after_agree');
                    try {
                        const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                        await sid.click({ clickCount: 3 });
                        await sid.type(login_user || '', { delay: 50 });
                        const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                        await pwd.click({ clickCount: 3 });
                        await pwd.type(login_pass || '', { delay: 50 });
                        const loginBtn = await page.waitForSelector('.c-button--login', { timeout: 10000 });
                        await loginBtn.click();
                        await delay(1000 + Math.random() * 1000);
                        await debugScreenshot(page, '03_after_login');
                    } catch (e) {
                        console.log('[update] login inputs not found or already logged in');
                    }
                }
            } catch (e) {
                console.log('[update] Sega login button not present; continuing');
            }

            if (await isErrorPage(page)) {
                console.log(`[attempt ${attemptIdx + 1}] server returned ERROR page after login; retrying`);
                continue; // cleanup happens in `finally`
            }

            // inject helper script (best-effort)
            try {
                await page.evaluate(() => {
                    if (["https://maimaidx.jp", "https://maimaidx-eng.com"].indexOf(location.origin) >= 0) {
                        const s = document.createElement('script');
                        s.src = 'https://myjian.github.io/mai-tools/scripts/all-in-one.js?t=' + Math.floor(Date.now() / 60000);
                        document.body.appendChild(s);
                    }
                });
            } catch (e) {}

            // Mongo setup
            const CONNECTION_STRING = process.env.MONGO_URI || 'mongodb://mongodb:27017/';
            client = new MongoClient(CONNECTION_STRING);
            await client.connect();
            const db = client.db(process.env.DB_NAME || 'mydatabase');
            // Explicit DD/MM/YYYY. toLocaleDateString() depends on the container
            // locale, so user_info.date could disagree with the DD/MM/YYYY used
            // in the *_top snapshots depending on where this ran.
            const now = new Date();
            const formattedDate = `${String(now.getDate()).padStart(2, '0')}/${String(
                now.getMonth() + 1
            ).padStart(2, '0')}/${now.getFullYear()}`;

            // get ryan info
            try {
                await getRyanInfo(page, db, formattedDate);
            } catch (e) {
                console.log('[update] get_ryan_info failed', e);
            }

            // mai-tools adds "Analyze Rating" link; wait for it to appear (same as friend page)
            try {
                await page.waitForFunction(
                    () => Array.from(document.querySelectorAll('a')).some((l) => l.textContent && l.textContent.includes('Analyze Rating')),
                    { timeout: 15000 }
                );
            } catch (e) {
                // link may not exist on this page layout
            }
            await delay(500);

            // click Analyze Rating (link text) – opens new tab with SEGA top record; wait for that tab
            try {
                const newPagePromise = waitForNewPage(browser);
                const clicked = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const a = links.find((l) => l.textContent && l.textContent.includes('Analyze Rating'));
                    if (a) {
                        a.click();
                        return true;
                    }
                    return false;
                });
                if (clicked) {
                    const targetPage = await newPagePromise;
                    const ryan_top = await getTopScore(targetPage);
                    await db.collection('ryan_top').insertOne(ryan_top);
                    console.log('[update] Done Ryan Score');
                    await targetPage.close();
                } else {
                    console.log('[update] Analyze Rating link not found on home page, skipping Ryan score');
                }
            } catch (e) {
                console.log('[update] analyze rating / ryan score failed', e);
            }

            // friends scraping: page 1 + page 2, then parallel fetch by friendIdx
            try {
                await page.goto('https://maimaidx-eng.com/maimai-mobile/friend/', { waitUntil: 'networkidle2' });
                try {
                    await page.evaluate(() => {
                        if (["https://maimaidx.jp", "https://maimaidx-eng.com"].indexOf(location.origin) >= 0) {
                            const s = document.createElement('script');
                            s.src = 'https://myjian.github.io/mai-tools/scripts/all-in-one.js?t=' + Math.floor(Date.now() / 60000);
                            document.body.appendChild(s);
                        }
                    });
                } catch (e) {}
                await page.waitForSelector('a[target="friendRating"]', { timeout: 10000 });
                await delay(2500); // let mai-tools script run before we click Analyze Rating
                await debugScreenshot(page, '04_friend_list');

                const allTasks = []; // [{ friendIdx }, ...] in order; we click by index on the page

                /** For current page: get each friend's link friendIdx (from URL), href, and from same block name/img/rating. */
                async function collectPageFriends(currentPage) {
                    await currentPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    return currentPage.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a[target="friendRating"]'));
                        return links.map((a) => {
                            let friendIdx = '';
                            try {
                                const u = new URL(a.href);
                                friendIdx = u.searchParams.get('friendIdx') || '';
                            } catch (e) {}
                            const block = a.closest('.see_through_block') || a.closest('.basic_block') || a.parentElement?.closest('div');
                            const img = block?.querySelector('.w_112.f_l');
                            const nameEl = block?.querySelector('.name_block.t_l.f_l.f_16.underline, .name_block.underline');
                            const ratingEl = block?.querySelector('.rating_block');
                            return {
                                friendIdx,
                                href: a.href || '',
                                name: nameEl?.textContent?.trim() || '',
                                img_src: img?.getAttribute?.('src') || img?.src || null,
                                rating: ratingEl?.textContent?.trim() || '',
                            };
                        });
                    });
                }

                // Page 1: collect user_info and task list; then click each "Analyze Rating" on this page (opens SEGA top-record tab)
                const page1Friends = await collectPageFriends(page);
                const page1Tasks = page1Friends.filter((f) => f.friendIdx && f.href).map((f) => ({ friendIdx: f.friendIdx }));
                await insertFriendUserInfo(db, formattedDate, page1Friends);
                allTasks.push(...page1Tasks);

                // Sequential: one click -> one new tab -> one getTopScore. (Multiple waitForNewPage listeners would all get the same first tab.)
                async function scrapeFriendsSequential(friendListPage, tasks, skipIdx = new Set()) {
                    const links = await friendListPage.$$('a[target="friendRating"]');
                    for (let i = 0; i < tasks.length; i++) {
                        const { friendIdx } = tasks[i];
                        // `links` is index-aligned with `tasks`, so skip in place
                        // rather than filtering the task list.
                        if (skipIdx.has(friendIdx)) continue;
                        if (!links[i]) continue;
                        const newPagePromise = waitForNewPage(browser);
                        await links[i].click();
                        let newPage;
                        try {
                            newPage = await newPagePromise;
                        } catch (e) {
                            console.log(`[update] failed friend_${friendIdx}: no new tab (${e.message})`);
                            continue;
                        }
                        await debugScreenshot(newPage, `05_friend_${friendIdx}`);
                        try {
                            const top = await getTopScore(newPage);
                            await db.collection(getTopCollectionName(friendIdx)).insertOne(top);
                            console.log(`[update] inserted friend_${friendIdx} top`);
                        } catch (e) {
                            console.log(`[update] failed friend_${friendIdx}:`, e.message);
                        } finally {
                            await newPage.close();
                            await delay(300);
                        }
                    }
                }
                await scrapeFriendsSequential(page, page1Tasks);

                // Page 2: click "next" button (img src contains btn_next.png)
                try {
                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    await delay(500);
                    const clicked = await page.evaluate(() => {
                        const form = document.querySelector('body > div.wrapper.main_wrapper.t_c > form') || document.querySelector('div.wrapper form');
                        if (!form) return false;
                        const nextImg = form.querySelector('img[src*="btn_next"]');
                        if (!nextImg) return false;
                        const btn = nextImg.closest('button');
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        return false;
                    });
                    if (clicked) {
                        const page1IdList = page1Tasks.map((t) => t.friendIdx);
                        try {
                            await Promise.race([
                                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
                                (async () => {
                                    for (let i = 0; i < 24; i++) {
                                        await delay(500);
                                        const ids = await page.evaluate((excludeList) => {
                                            const links = Array.from(document.querySelectorAll('a[target="friendRating"]'));
                                            return links.map((a) => {
                                                try { return new URL(a.href).searchParams.get('friendIdx'); } catch { return null; }
                                            }).filter(Boolean);
                                        }, page1IdList);
                                        if (ids.length > 0 && ids.some((id) => !excludeList.includes(id))) return;
                                    }
                                    throw new Error('timeout');
                                })(),
                            ]);
                        } catch (e) {
                            await delay(2000);
                        }
                        await delay(800);
                        try {
                            await page.evaluate(() => {
                                if (["https://maimaidx.jp", "https://maimaidx-eng.com"].indexOf(location.origin) >= 0) {
                                    const s = document.createElement('script');
                                    s.src = 'https://myjian.github.io/mai-tools/scripts/all-in-one.js?t=' + Math.floor(Date.now() / 60000);
                                    document.body.appendChild(s);
                                }
                            });
                        } catch (e) {}
                        await delay(2500);
                        const page2Friends = await collectPageFriends(page);
                        const page2Tasks = page2Friends.filter((f) => f.friendIdx && f.href).map((f) => ({ friendIdx: f.friendIdx }));
                        const page1IdSet = new Set(page1IdList);
                        const newOnPage2 = page2Tasks.filter((t) => !page1IdSet.has(t.friendIdx));
                        if (newOnPage2.length === 0) {
                            console.log('[update] page 2: no new friends (list unchanged or only one page)');
                        } else {
                            // Only insert/scrape friends we haven't already handled on page 1.
                            // Previously the whole of page 2 was re-scraped, duplicating any
                            // overlapping friend's user_info and top-score documents.
                            await insertFriendUserInfo(
                                db,
                                formattedDate,
                                page2Friends.filter((f) => !page1IdSet.has(f.friendIdx))
                            );
                            allTasks.push(...newOnPage2);
                            console.log('[update] collected friends from page 2:', newOnPage2.length);
                            await scrapeFriendsSequential(page, page2Tasks, page1IdSet);
                        }
                    } else {
                        console.log('[update] page 2: pagination button not found (only one page of friends?)');
                    }
                } catch (e2) {
                    console.log('[update] no second page or failed to load:', e2.message);
                }
            } catch (e) {
                console.log('[update] friend page processing failed:', e);
            }

            console.log('[update] finished successfully');
            return true;
        } catch (e) {
            console.log('[update] Unhandled exception during attempt:', e);
        } finally {
            if (client) {
                await client.close().catch((err) => console.log('[update] mongo close failed:', err.message));
            }
            if (browser) {
                await browser.close().catch((err) => console.log('[update] browser close failed:', err.message));
            }
        }
    }
    console.log('[update] finished attempts, nothing succeeded');
    return false;
}

if (require.main === module) {
    updateUserData()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { updateUserData };
