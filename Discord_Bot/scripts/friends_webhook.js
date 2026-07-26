const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const config = require('../config');
const { MongoClient } = require('mongodb');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// follow server/update_user_data.js: headless + ARM / Chromium handling + optional screenshots
const HEADLESS = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0';
const SCREENSHOT_DEBUG = process.env.SCREENSHOT_DEBUG === '1' || process.env.SCREENSHOT_DEBUG === 'true';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || 'screenshots';

const FALLBACK_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
const ALT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

async function debugScreenshot(page, stepName) {
    if (!SCREENSHOT_DEBUG || !page) return;
    try {
        const dir = SCREENSHOT_DIR;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = require('path').join(dir, `friends_${stepName}_${ts}.png`);
        await page.screenshot({ path: file });
        console.log(`[friends][screenshot] ${file}`);
    } catch (e) {
        console.log('[friends][screenshot] failed:', e.message);
    }
}

function sendToWebhook(webhookUrl, embeds) {
    if (!webhookUrl) {
        console.error('FRIEND_WEBHOOK_URL is not set; cannot send to Discord.');
        return Promise.resolve(false);
    }
    try {
        const url = new URL(webhookUrl);
        const payload = JSON.stringify({ embeds });

        const options = {
            method: 'POST',
            hostname: url.hostname,
            path: url.pathname + (url.search || ''),
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(true);
                    } else {
                        console.error('Webhook responded with status', res.statusCode, data);
                        resolve(false);
                    }
                });
            });
            req.on('error', (err) => {
                console.error('Error sending to webhook:', err);
                resolve(false);
            });
            req.write(payload);
            req.end();
        });
    } catch (e) {
        console.error('Invalid FRIEND_WEBHOOK_URL:', e.message);
        return Promise.resolve(false);
    }
}

async function clickVisibleAgreeCheckbox(page) {
    const selector = 'input.c-form__checkbox.js-agree';
    try {
        await delay(200);
        const inputs = await page.$$(selector);

        // Prefer the second checkbox explicitly, as requested
        const order = [];
        if (inputs.length >= 2) {
            order.push(inputs[1], inputs[0]);
            for (let i = 2; i < inputs.length; i++) order.push(inputs[i]);
        } else {
            order.push(...inputs);
        }

        for (let i = 0; i < order.length; i++) {
            const el = order[i];
            const box = await el.boundingBox();
            if (!box) continue;
            try {
                await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
            } catch (e) {}
            try {
                await el.click({ delay: 50 });
                console.log(`[friends][agree] clicked checkbox index ${i} (ordered)`);
                return true;
            } catch (e) {
                try {
                    await page.evaluate((e) => e.click(), el);
                    console.log(`[friends][agree] clicked checkbox index ${i} via JS click`);
                    return true;
                } catch (err) {}
            }
        }
    } catch (e) {}

    try {
        const parent = await page.$('#agree-maimaidxex');
        if (parent) {
            const label = await parent.$('label');
            if (label) {
                try {
                    await label.click();
                    return true;
                } catch (e) {
                    try {
                        await page.evaluate((el) => el.click(), label);
                        return true;
                    } catch (err) {}
                }
            }
        }
    } catch (e) {}
    return false;
}

async function isErrorPage(page) {
    try {
        const url = page.url();
        const title = (await page.title()) || '';
        const content = await page.content();
        const hasErrorTitle = title.toUpperCase().includes('ERROR');
        const hasAimeError = content.includes('Aime service site') && content.includes('Error');
        const errEl = await page.$('#error-ui');
        const hasErrEl = !!errEl;

        console.log(
            '[friends][isErrorPage]',
            JSON.stringify({
                url,
                title,
                hasErrorTitle,
                hasAimeError,
                hasErrEl,
                contentLength: content.length,
            })
        );

        if (hasErrorTitle || hasAimeError || hasErrEl) return true;
    } catch (e) {}
    return false;
}

async function collectFriendsFromCurrentPage(page) {
    // Uses the DOM structure you provided: each friend in .see_through_block with inner .basic_block
    return page.evaluate(() => {
        const blocks = Array.from(
            document.querySelectorAll('div.see_through_block.p_r.m_15.m_t_5.p_10.t_l.f_0, div.see_through_block')
        );
        const results = [];
        for (const block of blocks) {
            const basic = block.querySelector('.basic_block') || block;
            const img = basic.querySelector('img.w_112.f_l');
            const nameEl = basic.querySelector('.name_block.t_l.f_l.f_16.underline, .name_block.underline');
            const ratingEl = basic.querySelector('.rating_block');

            // idx is in hidden input[name="idx"] inside the friendDetail form
            let idx = null;
            const detailForm = basic.querySelector('form[action*="/friend/friendDetail/"]');
            const idxInput =
                (detailForm && detailForm.querySelector('input[name="idx"]')) ||
                basic.querySelector('input[name="idx"]');
            if (idxInput && idxInput.value) {
                idx = idxInput.value.trim();
            }

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

async function getFriendPaginationInfo(page) {
    // Reads the pager form:
    // <div class="d_i v_t white">
    //   <input name="idx" value="1" class="pager v_t">
    //   <div class="d_ib m_5 p_t_10 v_t">/5</div>
    // </div>
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

async function goToNextFriendPage(page) {
    // Clicks the btn_next.png image button when another page exists
    return page.evaluate(() => {
        const form =
            document.querySelector('body > div.wrapper.main_wrapper.t_c > form') ||
            document.querySelector('div.wrapper form') ||
            document.querySelector('form');
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
}

async function scrapeAllFriends(page, maxPages = 50) {
    const all = [];
    for (let i = 0; i < maxPages; i++) {
        await page.waitForSelector('body', { visible: true, timeout: 60000 });
        const pageInfo = await getFriendPaginationInfo(page);
        console.log('[friends] scraping friend page', pageInfo.current, '/', pageInfo.total, 'raw =', pageInfo.raw);

        const onPage = await collectFriendsFromCurrentPage(page);
        if (onPage.length === 0 && i > 0) break;
        all.push(...onPage);

        // Stop if there is no next page according to the indicator
        if (!pageInfo.total || pageInfo.current >= pageInfo.total) {
            break;
        }

        const hasNext = await goToNextFriendPage(page);
        if (!hasNext) break;
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch (e) {
            break;
        }
    }
    return all;
}

async function loginAndScrapeFriendsForAccount(account) {
    const login_user = account.sid || '';
    const login_pass = account.password || '';
    const user_agent_env = (process.env.USER_AGENT || '').trim();
    const user_agent = user_agent_env || FALLBACK_UA;
    const attempts = [user_agent, ALT_UA];

    // L245-L255 equivalent from server/update_user_data.js, but allow config override
    let executablePath = config.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!executablePath && process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64')) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    if (executablePath) {
        console.log('[friends] using browser:', executablePath);
    } else if (process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64')) {
        console.log(
            '[friends] no system Chromium found. On ARM the bundled browser is x86 and will fail. ' +
                'Install chromium or set CHROME_EXECUTABLE_PATH / PUPPETEER_EXECUTABLE_PATH.'
        );
    }

    if (!HEADLESS) {
        console.log(
            '[friends] Running with visible browser (HEADLESS=false). Use SSH -X or a local session if you want to see it.'
        );
    }

    console.log(`[friends] starting scrape for ${account.label || account.sid}`);
    let browser = null;

    for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
        const ua = attempts[attemptIdx];
        console.log(`[friends][attempt ${attemptIdx + 1}] using UA: ${ua}`);
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

            console.log('[friends] navigating to maimaidx-eng.com');
            await page.goto('https://maimaidx-eng.com', { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('[friends] after goto, url =', page.url(), 'title =', await page.title());
            await debugScreenshot(page, `01_home_attempt${attemptIdx + 1}`);

            const currentUrl = page.url();

            // New flow: if we are already on the Aime login gateway, skip Sega button and just log in.
            if (currentUrl.includes('common_auth/login')) {
                console.log('[friends] Detected Aime login gateway directly, using Sega button + sid/password');
                try {
                    // Always click Sega button first on this page
                    const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                    console.log('[friends] Sega login button found on gateway, clicking');
                    await debugScreenshot(page, `02_gateway_before_sega_click_attempt${attemptIdx + 1}`);
                    await segaBtn.click();
                    await clickVisibleAgreeCheckbox(page);
                    await delay(500 + Math.random() * 1000);
                    console.log('[friends] after Sega click on gateway, url =', page.url(), 'title =', await page.title());
                    await debugScreenshot(page, `03_gateway_after_sega_click_attempt${attemptIdx + 1}`);

                    const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                    console.log('[friends] sid input found, typing user');
                    await debugScreenshot(page, `02_before_sid_type_attempt${attemptIdx + 1}`);
                    await sid.click({ clickCount: 3 });
                    await sid.type(login_user || '', { delay: 50 });
                    // Type password robustly (handle non-clickable / off-screen input)
                    let pwdTyped = false;
                    try {
                        const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                        console.log('[friends] password input found, trying to type');
                        await debugScreenshot(page, `03_before_pwd_type_attempt${attemptIdx + 1}`);
                        try {
                            await pwd.evaluate((el) => el.scrollIntoView({ block: 'center' }));
                        } catch {}
                        try {
                            await pwd.click({ clickCount: 3 });
                        } catch {}
                        try {
                            await pwd.type(login_pass || '', { delay: 50 });
                            pwdTyped = true;
                        } catch (e) {
                            console.log('[friends] pwd.type failed, falling back to JS set:', e.message);
                        }
                    } catch (e) {
                        console.log('[friends] #password selector not found, trying generic password input:', e.message);
                        try {
                            await page.type('input[type="password"]', login_pass || '', { delay: 50 });
                            pwdTyped = true;
                        } catch (e2) {
                            console.log('[friends] generic password type failed:', e2.message);
                        }
                    }

                    if (!pwdTyped && login_pass) {
                        // Last resort: set via JS on first password field
                        await page.evaluate((pass) => {
                            const input =
                                document.querySelector('#password') ||
                                document.querySelector('input[type="password"]');
                            if (input) {
                                (input).value = pass;
                            }
                        }, login_pass || '');
                        console.log('[friends] password set via JS value');
                        await debugScreenshot(page, `04_after_pwd_js_attempt${attemptIdx + 1}`);
                    } else {
                        console.log('[friends] password typed successfully');
                        await debugScreenshot(page, `04_after_pwd_type_attempt${attemptIdx + 1}`);
                    }

                    // The gateway page sometimes uses non-button elements; submit the form via JS instead of relying on a specific button class.
                    console.log('[friends] submitting login form via JS');
                    await debugScreenshot(page, `05_before_form_submit_attempt${attemptIdx + 1}`);
                    await page.evaluate(() => {
                        const form =
                            document.querySelector('form[name="loginForm"]') ||
                            document.querySelector('form[action*="common_auth/login"]') ||
                            document.querySelector('form');
                        if (form) form.submit();
                    });

                    // wait for redirect back to maimai site
                    try {
                        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                    } catch (e) {
                        console.log('[friends] waitForNavigation after login timed out:', e.message);
                    }

                    console.log('[friends] after login submit, url =', page.url(), 'title =', await page.title());
                    await debugScreenshot(page, `06_after_login_attempt${attemptIdx + 1}`);
                } catch (e) {
                    console.log('[friends] login via gateway failed:', e.message);
                }
            } else {
                // Legacy flow: click Sega ID button on maimaidx-eng.com then log in on the redirected page
                try {
                    const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                    if (segaBtn) {
                        console.log('[friends] Sega login button found, clicking');
                        await debugScreenshot(page, `02b_before_sega_click_attempt${attemptIdx + 1}`);
                    await segaBtn.click();
                    await clickVisibleAgreeCheckbox(page);
                    await delay(500 + Math.random() * 1000);
                        console.log('[friends] after Sega click, url =', page.url(), 'title =', await page.title());
                        await debugScreenshot(page, `03b_after_sega_click_attempt${attemptIdx + 1}`);
                        try {
                            const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                            console.log('[friends] sid input found, typing user');
                            await debugScreenshot(page, `04b_before_sid_type_attempt${attemptIdx + 1}`);
                            await sid.click({ clickCount: 3 });
                            await sid.type(login_user || '', { delay: 50 });
                            const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                            console.log('[friends] password input found, typing pass');
                            await debugScreenshot(page, `05b_before_pwd_type_attempt${attemptIdx + 1}`);
                            await pwd.click({ clickCount: 3 });
                            await pwd.type(login_pass || '', { delay: 50 });
                            const loginBtn = await page.waitForSelector('.c-button--login', { timeout: 10000 });
                            console.log('[friends] login button found, clicking');
                            await debugScreenshot(page, `06b_before_login_click_attempt${attemptIdx + 1}`);
                            await loginBtn.click();
                            await delay(1000 + Math.random() * 1000);
                            console.log('[friends] after login submit, url =', page.url(), 'title =', await page.title());
                            await debugScreenshot(page, `07b_after_login_attempt${attemptIdx + 1}`);
                        } catch (e) {
                            console.log('[friends] login inputs not found or already logged in:', e.message);
                        }
                    } else {
                        console.log('[friends] Sega login button selector resolved but element falsy');
                    }
                } catch (e) {
                    console.log(
                        '[friends] Sega login button not present; continuing. url =',
                        page.url(),
                        'title =',
                        await page.title()
                    );
                }
            }

            if (await isErrorPage(page)) {
                await debugScreenshot(page, `03_error_attempt${attemptIdx + 1}`);
                console.log(`[friends][attempt ${attemptIdx + 1}] server returned ERROR page after login; retrying`);
                try {
                    await page.close();
                } catch (e) {}
                await browser.close();
                browser = null;
                continue;
            }

            try {
                await page.goto('https://maimaidx-eng.com/maimai-mobile/friend/', {
                    waitUntil: 'networkidle2',
                    timeout: 60000,
                });
                await debugScreenshot(page, `08_friend_page_attempt${attemptIdx + 1}`);
            } catch (e) {
                console.error('[friends] failed to open friend page:', e.message);
                await browser.close();
                browser = null;
                continue;
            }

            const friends = await scrapeAllFriends(page);
            try {
                await browser.close();
            } catch (e) {}

            console.log(
                `[friends] collected ${friends.length} entries for ${account.label || account.sid}`
            );
            return friends;
        } catch (e) {
            console.log('[friends] Unhandled exception during attempt:', e);
            if (browser) {
                try {
                    await browser.close();
                } catch (err) {}
                browser = null;
            }
            continue;
        }
    }
    console.log('[friends] finished attempts, nothing succeeded for', account.label || account.sid);
    return [];
}

function parseRatingToNumber(ratingText) {
    if (!ratingText) return null;
    const m = String(ratingText).match(/(\d+(\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function getCalendarDayUTC(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getSnapshotCollectionName(accountType) {
    return accountType === 'main' ? 'friend_rating_daily_snapshots_main' : 'friend_rating_daily_snapshots';
}

function getAccountCredentials(accountType) {
    const type = accountType === 'main' ? 'main' : 'fy';
    if (type === 'main') {
        return {
            sid: config.MAIMAI_ACCOUNT_RATING_MAIN || '',
            password: config.MAIMAI_PASSWORD_RATING || '',
        };
    }
    return {
        sid: config.MAIMAI_ACCOUNT_RATING_FY || '',
        password: config.MAIMAI_PASSWORD_RATING || '',
    };
}

async function saveFriendRatingsSnapshot(friends, accountType = 'fy') {
    if (!friends || friends.length === 0) return false;

    const snapshotDate = getCalendarDayUTC(new Date());
    const client = new MongoClient(config.MONGO_URI);
    const dbName = 'mydatabase';

    // Store ONE document per day.
    // Each entry includes only: friendIdx, name, rating (numeric).
    const mappedFriends = friends
        .filter((f) => f)
        .map((f) => ({
            friendIdx: f.idx ?? null,
            name: f.name || '',
            rating: parseRatingToNumber(f.rating),
        }))
        .filter((f) => f.friendIdx && f.rating != null);

    if (mappedFriends.length === 0) {
        console.error('[friends][save] snapshot has no valid ratings; skipping save');
        return false;
    }

    const doc = {
        snapshotDate,
        friends: mappedFriends,
        scrapedAt: new Date(),
    };

    await client.connect();
    const db = client.db(dbName);
    const col = db.collection(getSnapshotCollectionName(accountType));

    // Replace the snapshot for this day (idempotent)
    await col.deleteMany({ snapshotDate });
    await col.insertOne(doc);
    await client.close();

    console.log(`[friends][save] saved ${mappedFriends.length} friends for ${snapshotDate} (${accountType})`);
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

    const parsed = friends.map((f) => {
        let ratingNum = null;
        if (f.rating) {
            const m = String(f.rating).match(/(\d+(\.\d+)?)/);
            if (m) ratingNum = parseFloat(m[1]);
        }
        return { ...f, ratingNum };
    });

    parsed.sort((a, b) => {
        const ra = a.ratingNum != null ? a.ratingNum : -Infinity;
        const rb = b.ratingNum != null ? b.ratingNum : -Infinity;
        return rb - ra;
    });

    const lines = parsed.map((f, i) => {
        const rank = i + 1;
        const ratingStr = f.rating || (f.ratingNum != null ? `${f.ratingNum} rt` : 'N/A');
        const name = f.name || '(unknown)';
        return `\`${rank.toString().padStart(2, '0')}.\` **${name}** — ${ratingStr}`;
    });

    const MAX_CHARS = 4000;
    const chunks = [];
    let current = [];
    let currentLen = 0;
    for (const line of lines) {
        if (currentLen + line.length + 1 > MAX_CHARS && current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    }
    if (current.length > 0) {
        chunks.push(current.join('\n'));
    }

    return chunks.map((desc, idx) => ({
        title:
            idx === 0
                ? `Rating rankings for FY group`
                : `Friend ratings for ${account.label || account.sid} (cont. ${idx + 1})`,
        description: desc,
        color: 0x7289da,
    }));
}

async function run(opts = {}) {
    const sendWebhook =
        opts.sendWebhook ??
        (process.env.SEND_FRIEND_WEBHOOK === '1' ||
            process.env.SEND_FRIEND_WEBHOOK === 'true' ||
            process.env.SEND_FRIEND_WEBHOOK === 'TRUE');

    const doSave = opts.saveToMongo ?? true;
    const accountType = opts.accountType === 'main' ? 'main' : 'fy';
    const webhookType = opts.webhookType === 'test' ? 'test' : 'fy';

    const webhookUrl =
        webhookType === 'test'
            ? config.FRIEND_WEBHOOK_URL_TEST
            : config.FRIEND_WEBHOOK_URL_FY;

    const creds = getAccountCredentials(accountType);
    const accountSid = creds.sid;
    const accountPass = creds.password;

    if (!accountSid || !accountPass) {
        console.error(
            `Missing credentials for accountType="${accountType}". Set MAIMAI_ACCOUNT_RATING_${accountType.toUpperCase()} in config.`
        );
        return { ok: false, error: 'missing credentials' };
    }

    const account = {
        sid: accountSid,
        password: accountPass,
        label: accountType === 'main' ? 'MAIN' : 'FY',
    };

    try {
        const friends = await loginAndScrapeFriendsForAccount(account);
        if (doSave) {
            await saveFriendRatingsSnapshot(friends, accountType);
        }
        if (sendWebhook) {
            const embeds = buildEmbedsForAccount(account, friends);
            await sendToWebhook(webhookUrl, embeds);
        }
        return { ok: true, friendsCount: friends.length };
    } catch (e) {
        console.error('Error processing account', account.label || account.sid, e);
        return { ok: false, error: String(e) };
    }
}

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { run };

