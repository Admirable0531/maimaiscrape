const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

const FALLBACK_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
const ALT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

async function clickVisibleAgreeCheckbox(page) {
    const selector = 'input.c-form__checkbox.js-agree';
    try {
        await page.waitForTimeout(200); // small pause
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

async function getTopScore(page) {
    // returns structure similar to Python version
    await page.waitForSelector('.topRecordTable.songRecordTable', { timeout: 60000 });
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
        return { new: newTbl, old: oldTbl, rating, Date: new Date().toLocaleString() };
    });
    return data;
}

async function getRyanInfo(page, db, formattedDate) {
    await page.waitForSelector('.w_112.f_l', { visible: true, timeout: 60000 });
    const user_img_src = await page.$eval('.w_112.f_l', (el) => el.getAttribute('src'));
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

async function getUserInfo(page, db, formattedDate) {
    await page.waitForSelector('body', { visible: true });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const user_img_src = await page.$$eval('.w_112.f_l', (els) => els.map((e) => e.getAttribute('src')));
    const user_name = await page.$$eval('.name_block.t_l.f_l.f_16.underline', (els) => els.map((e) => e.textContent.trim()));
    const user_rating = await page.$$eval('.rating_block', (els) => els.map((e) => e.textContent.trim()));
    const mapping = { 3: 'yuchen', 4: 'marcus', 5: 'kok', 6: 'yuan', 7: 'keyang' };
    for (let i = 3; i <= 7; i++) {
        const choose = mapping[i];
        if (!choose) continue;
        try {
            const user_data = {
                user: choose,
                img_src: user_img_src[i],
                name: user_name[i],
                rating: user_rating[i],
                date: formattedDate,
            };
            await db.collection('user_info').insertOne(user_data);
            console.log(`[get_user_info] inserted ${choose}`);
        } catch (err) {
            console.log(`[get_user_info] index error for ${choose}: skipping`);
            continue;
        }
    }
}

async function updateUserData() {
    const login_user = process.env.MAIMAI_USER || '';
    const login_pass = process.env.MAIMAI_PASS || '';
    const user_agent_env = (process.env.USER_AGENT || '').trim();
    const user_agent = user_agent_env || FALLBACK_UA;
    const attempts = [user_agent, ALT_UA];

    console.log('[update] starting update');
    let browser = null;
    for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
        const ua = attempts[attemptIdx];
        console.log(`[attempt ${attemptIdx + 1}] using UA: ${ua}`);
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                defaultViewport: { width: 1280, height: 1024 },
            });
            const page = await browser.newPage();
            await page.setUserAgent(ua);
            await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

            await page.goto('https://maimaidx-eng.com', { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('[update] page loaded');

            // click Sega login button if present
            try {
                const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                if (segaBtn) {
                    console.log('[update] clicking sega login button');
                    await segaBtn.click();
                    await clickVisibleAgreeCheckbox(page);
                    await page.waitForTimeout(500 + Math.random() * 1000);
                    try {
                        const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                        await sid.click({ clickCount: 3 });
                        await sid.type(login_user || '', { delay: 50 });
                        const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                        await pwd.click({ clickCount: 3 });
                        await pwd.type(login_pass || '', { delay: 50 });
                        const loginBtn = await page.waitForSelector('.c-button--login', { timeout: 10000 });
                        await loginBtn.click();
                        await page.waitForTimeout(1000 + Math.random() * 1000);
                    } catch (e) {
                        console.log('[update] login inputs not found or already logged in');
                    }
                }
            } catch (e) {
                console.log('[update] Sega login button not present; continuing');
            }

            if (await isErrorPage(page)) {
                console.log(`[attempt ${attemptIdx + 1}] server returned ERROR page after login; retrying`);
                try {
                    await page.close();
                } catch (e) {}
                await browser.close();
                browser = null;
                continue; // try next UA
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
            const client = new MongoClient(CONNECTION_STRING);
            await client.connect();
            const db = client.db('mydatabase');
            const formattedDate = new Date().toLocaleDateString();

            // get ryan info
            try {
                await getRyanInfo(page, db, formattedDate);
            } catch (e) {
                console.log('[update] get_ryan_info failed', e);
            }

            // click Analyze Rating (link text)
            try {
                const anchors = await page.$x("//a[contains(., 'Analyze Rating')]");
                if (anchors.length > 0) {
                    await anchors[0].click();
                    await page.waitForTimeout(1000);
                    // may open new tab
                    const pages = await browser.pages();
                    const targetPage = pages.length > 1 ? pages[pages.length - 1] : page;
                    const ryan_top = await getTopScore(targetPage);
                    await db.collection('ryan_top').insertOne(ryan_top);
                    console.log('[update] Done Ryan Score');
                }
            } catch (e) {
                console.log('[update] analyze rating / ryan score failed', e);
            }

            // friends scraping
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
                await getUserInfo(page, db, formattedDate);
                await page.waitForSelector('a[target="friendRating"]', { timeout: 10000 });
                const elements = await page.$$('a[target="friendRating"]');
                const friend_collections = [
                    ['yuchen', 3, 'yuchen_top'],
                    ['marcus', 4, 'marcus_top'],
                    ['kok', 5, 'kok_top'],
                    ['yuan', 6, 'yuan_top'],
                    ['keyang', 7, 'keyang_top'],
                ];
                for (const [name, idx, col] of friend_collections) {
                    try {
                        const el = elements[idx];
                        if (!el) {
                            console.log(`[update] elements index ${idx} missing for ${name}`);
                            continue;
                        }
                        await el.click();
                        await page.waitForTimeout(500);
                        const pages = await browser.pages();
                        const targetPage = pages.length > 1 ? pages[pages.length - 1] : page;
                        const top = await getTopScore(targetPage);
                        await db.collection(col).insertOne(top);
                        console.log(`[update] inserted ${name} top`);
                    } catch (e) {
                        console.log(`[update] failed to get top for ${name}:`, e);
                    }
                }
            } catch (e) {
                console.log('[update] friend page processing failed:', e);
            }

            console.log('[update] finished successfully');
            await client.close();
            try {
                await browser.close();
            } catch (e) {}
            return true;
        } catch (e) {
            console.log('[update] Unhandled exception during attempt:', e);
            if (browser) {
                try {
                    await browser.close();
                } catch (err) {}
                browser = null;
            }
            continue;
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
module.exports = {};
