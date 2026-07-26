const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const config = require('../config');
const { MongoClient } = require('mongodb');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Follow server/update_user_data.js: headless + ARM / Chromium handling + optional screenshots
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
        const file = require('path').join(dir, `circle_${stepName}_${ts}.png`);
        await page.screenshot({ path: file });
        console.log(`[circle][screenshot] ${file}`);
    } catch (e) {
        console.log('[circle][screenshot] failed:', e.message);
    }
}

function sendToWebhook(webhookUrl, embeds) {
    if (!webhookUrl) {
        console.error('Webhook URL is not set; cannot send to Discord.');
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
        console.error('Invalid webhook URL:', e.message);
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
                console.log(`[circle][agree] clicked checkbox index ${i} (ordered)`);
                return true;
            } catch (e) {
                try {
                    await page.evaluate((e) => e.click(), el);
                    console.log(`[circle][agree] clicked checkbox index ${i} via JS click`);
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
            '[circle][isErrorPage]',
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

async function isMaintenancePage(page) {
    try {
        const content = await page.content();
        const title = (await page.title()) || '';
        
        // Check for maintenance indicators
        const hasMaintenanceText = content.toLowerCase().includes('maintenance') || 
                                 content.toLowerCase().includes('メンテナンス') ||
                                 title.toLowerCase().includes('maintenance');
        
        console.log('[circle][isMaintenancePage]', {
            hasMaintenanceText,
            title,
            url: page.url()
        });
        
        return hasMaintenanceText;
    } catch (e) {
        console.log('[circle][isMaintenancePage] error:', e.message);
        return false;
    }
}

async function scrapeCircleRankingPage(page) {
    try {
        // Navigate to circle ranking page
        console.log('[circle] navigating to circle ranking page');
        await page.goto('https://maimaidx-eng.com/maimai-mobile/circle/circleRanking/', {
            waitUntil: 'networkidle2',
            timeout: 60000,
        });
        
        await debugScreenshot(page, 'circle_ranking_page');
        
        // Check if maintenance page
        if (await isMaintenancePage(page)) {
            console.log('[circle] maintenance page detected');
            return { maintenance: true, rankings: [] };
        }
        
        // Check if error page
        if (await isErrorPage(page)) {
            console.log('[circle] error page detected');
            return { error: true, rankings: [] };
        }

        // Wait for ranking elements to load
        await page.waitForSelector('.ranking_top_block', { timeout: 30000 });
        
        // Scrape all ranking entries - handle both top 3 and regular ranking elements
        const rankings = await page.evaluate(() => {
            const results = [];
            
            // Get ALL ranking elements in order and process them sequentially
            const allRankingElements = [];
            
            // First, collect top 3 rankings (ranking_top_block)
            const topBlocks = document.querySelectorAll('.ranking_top_block.f_0');
            topBlocks.forEach(block => {
                allRankingElements.push({ block, type: 'top' });
            });
            
            // Then, collect regular rankings (ranking_block)
            const regularBlocks = document.querySelectorAll('.ranking_block.f_0');
            regularBlocks.forEach(block => {
                allRankingElements.push({ block, type: 'regular' });
            });
            
            // Process all elements in order
            allRankingElements.forEach((item, globalIndex) => {
                try {
                    const { block, type } = item;
                    const innerBlock = type === 'top' 
                        ? block.querySelector('.ranking_top_inner_block')
                        : block.querySelector('.ranking_inner_block');
                    
                    if (!innerBlock) return;
                    
                    // Get group name
                    const nameElement = innerBlock.querySelector('.f_l.p_t_10.p_l_10.f_15');
                    const groupName = nameElement ? nameElement.textContent.trim() : '';
                    
                    // Get points
                    const pointsElement = innerBlock.querySelector('.p_t_10.p_r_10.f_r.f_14');
                    const pointsText = pointsElement ? pointsElement.textContent.trim() : '';
                    
                    // Extract numeric points value
                    const pointsMatch = pointsText.match(/(\d+)/);
                    const points = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;
                    
                    // Determine rank - use globalIndex + 1 as fallback
                    let rank = globalIndex + 1;
                    
                    const rankImg = innerBlock.querySelector('.ranking_rank_block img');
                    if (rankImg && rankImg.src) {
                        if (type === 'top') {
                            // For top 3, use image detection
                            if (rankImg.src.includes('rank_first')) rank = 1;
                            else if (rankImg.src.includes('rank_second')) rank = 2;
                            else if (rankImg.src.includes('rank_third')) rank = 3;
                        } else {
                            // For regular rankings, extract from image filename
                            const rankMatch = rankImg.src.match(/rank_num_(\d+)/);
                            if (rankMatch) {
                                rank = parseInt(rankMatch[1], 10);
                            }
                        }
                    }
                    
                    if (groupName && points > 0) {
                        results.push({
                            rank,
                            groupName,
                            points,
                            pointsText,
                            type // for debugging
                        });
                    }
                } catch (e) {
                    console.error('Error parsing ranking block:', e);
                }
            });
            
            return results;
        });
        
        console.log(`[circle] scraped ${rankings.length} circle rankings`);
        return { maintenance: false, error: false, rankings };
        
    } catch (e) {
        console.error('[circle] error scraping circle ranking page:', e.message);
        return { error: true, rankings: [] };
    }
}

async function loginAndScrapeCircleRanking() {
    const login_user = config.MAIMAI_ACCOUNT_RATING_FY || '';
    const login_pass = config.MAIMAI_PASSWORD_RATING || '';
    const user_agent_env = (process.env.USER_AGENT || '').trim();
    const user_agent = user_agent_env || FALLBACK_UA;
    const attempts = [user_agent, ALT_UA];

    // Browser setup similar to friends_webhook.js
    let executablePath = config.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!executablePath && process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64')) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    if (executablePath) {
        console.log('[circle] using browser:', executablePath);
    }

    if (!HEADLESS) {
        console.log('[circle] Running with visible browser (HEADLESS=false).');
    }

    console.log(`[circle] starting scrape with account ${login_user}`);
    let browser = null;

    for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
        const ua = attempts[attemptIdx];
        console.log(`[circle][attempt ${attemptIdx + 1}] using UA: ${ua}`);
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

            console.log('[circle] navigating to maimaidx-eng.com');
            await page.goto('https://maimaidx-eng.com', { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('[circle] after goto, url =', page.url(), 'title =', await page.title());
            await debugScreenshot(page, `01_home_attempt${attemptIdx + 1}`);

            const currentUrl = page.url();

            // Login flow similar to friends_webhook.js
            if (currentUrl.includes('common_auth/login')) {
                console.log('[circle] Detected Aime login gateway directly, using Sega button + sid/password');
                try {
                    const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                    console.log('[circle] Sega login button found on gateway, clicking');
                    await debugScreenshot(page, `02_gateway_before_sega_click_attempt${attemptIdx + 1}`);
                    await segaBtn.click();
                    await clickVisibleAgreeCheckbox(page);
                    await delay(500 + Math.random() * 1000);
                    console.log('[circle] after Sega click on gateway, url =', page.url(), 'title =', await page.title());
                    await debugScreenshot(page, `03_gateway_after_sega_click_attempt${attemptIdx + 1}`);

                    const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                    console.log('[circle] sid input found, typing user');
                    await debugScreenshot(page, `02_before_sid_type_attempt${attemptIdx + 1}`);
                    await sid.click({ clickCount: 3 });
                    await sid.type(login_user || '', { delay: 50 });
                    
                    // Type password robustly
                    let pwdTyped = false;
                    try {
                        const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                        console.log('[circle] password input found, trying to type');
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
                            console.log('[circle] pwd.type failed, falling back to JS set:', e.message);
                        }
                    } catch (e) {
                        console.log('[circle] #password selector not found, trying generic password input:', e.message);
                        try {
                            await page.type('input[type="password"]', login_pass || '', { delay: 50 });
                            pwdTyped = true;
                        } catch (e2) {
                            console.log('[circle] generic password type failed:', e2.message);
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
                        console.log('[circle] password set via JS value');
                        await debugScreenshot(page, `04_after_pwd_js_attempt${attemptIdx + 1}`);
                    } else {
                        console.log('[circle] password typed successfully');
                        await debugScreenshot(page, `04_after_pwd_type_attempt${attemptIdx + 1}`);
                    }

                    // Submit login form
                    console.log('[circle] submitting login form via JS');
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
                        console.log('[circle] waitForNavigation after login timed out:', e.message);
                    }

                    console.log('[circle] after login submit, url =', page.url(), 'title =', await page.title());
                    await debugScreenshot(page, `06_after_login_attempt${attemptIdx + 1}`);
                } catch (e) {
                    console.log('[circle] login via gateway failed:', e.message);
                }
            } else {
                // Legacy flow: click Sega ID button on maimaidx-eng.com then log in on the redirected page
                try {
                    const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
                    if (segaBtn) {
                        console.log('[circle] Sega login button found, clicking');
                        await debugScreenshot(page, `02b_before_sega_click_attempt${attemptIdx + 1}`);
                        await segaBtn.click();
                        await clickVisibleAgreeCheckbox(page);
                        await delay(500 + Math.random() * 1000);
                        console.log('[circle] after Sega click, url =', page.url(), 'title =', await page.title());
                        await debugScreenshot(page, `03b_after_sega_click_attempt${attemptIdx + 1}`);
                        try {
                            const sid = await page.waitForSelector('#sid', { timeout: 20000 });
                            console.log('[circle] sid input found, typing user');
                            await debugScreenshot(page, `04b_before_sid_type_attempt${attemptIdx + 1}`);
                            await sid.click({ clickCount: 3 });
                            await sid.type(login_user || '', { delay: 50 });
                            const pwd = await page.waitForSelector('#password', { timeout: 20000 });
                            console.log('[circle] password input found, typing pass');
                            await debugScreenshot(page, `05b_before_pwd_type_attempt${attemptIdx + 1}`);
                            await pwd.click({ clickCount: 3 });
                            await pwd.type(login_pass || '', { delay: 50 });
                            const loginBtn = await page.waitForSelector('.c-button--login', { timeout: 10000 });
                            console.log('[circle] login button found, clicking');
                            await debugScreenshot(page, `06b_before_login_click_attempt${attemptIdx + 1}`);
                            await loginBtn.click();
                            await delay(1000 + Math.random() * 1000);
                            console.log('[circle] after login submit, url =', page.url(), 'title =', await page.title());
                            await debugScreenshot(page, `07b_after_login_attempt${attemptIdx + 1}`);
                        } catch (e) {
                            console.log('[circle] login inputs not found or already logged in:', e.message);
                        }
                    } else {
                        console.log('[circle] Sega login button selector resolved but element falsy');
                    }
                } catch (e) {
                    console.log(
                        '[circle] Sega login button not present; continuing. url =',
                        page.url(),
                        'title =',
                        await page.title()
                    );
                }
            }

            if (await isErrorPage(page)) {
                await debugScreenshot(page, `03_error_attempt${attemptIdx + 1}`);
                console.log(`[circle][attempt ${attemptIdx + 1}] server returned ERROR page after login; retrying`);
                try {
                    await page.close();
                } catch (e) {}
                await browser.close();
                browser = null;
                continue;
            }

            // Now scrape the circle ranking page
            const result = await scrapeCircleRankingPage(page);
            
            try {
                await browser.close();
            } catch (e) {}

            console.log(`[circle] scrape completed, found ${result.rankings.length} rankings`);
            return result;
            
        } catch (e) {
            console.log('[circle] Unhandled exception during attempt:', e);
            if (browser) {
                try {
                    await browser.close();
                } catch (err) {}
                browser = null;
            }
            continue;
        }
    }
    console.log('[circle] finished attempts, nothing succeeded');
    return { error: true, rankings: [] };
}

function getCalendarDayUTC(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function saveCircleRankingSnapshot(rankings) {
    if (!rankings || rankings.length === 0) return false;

    const snapshotDate = getCalendarDayUTC(new Date());
    
    // Try different MongoDB URIs for Docker vs local environments
    const mongoUris = [
        config.MONGO_URI, // Docker URI: mongodb://mongodb:27017/mydatabase
        'mongodb://localhost:27017/mydatabase', // Local URI
        'mongodb://127.0.0.1:27017/mydatabase'  // Alternative local URI
    ];
    
    let client = null;
    let connected = false;
    
    for (const uri of mongoUris) {
        try {
            console.log(`[circle][mongo] trying to connect to: ${uri}`);
            client = new MongoClient(uri);
            await client.connect();
            // Test the connection
            await client.db('mydatabase').admin().ping();
            console.log(`[circle][mongo] successfully connected to: ${uri}`);
            connected = true;
            break;
        } catch (e) {
            console.log(`[circle][mongo] failed to connect to ${uri}:`, e.message);
            if (client) {
                try { await client.close(); } catch (err) {}
                client = null;
            }
        }
    }
    
    if (!connected || !client) {
        console.error('[circle][mongo] failed to connect to any MongoDB instance');
        return false;
    }
    
    const dbName = 'mydatabase';
    const collectionName = 'circle_rankings';

    try {
        const now = new Date();
        const doc = {
            snapshotDate,
            rankings: rankings.map(r => ({
                rank: r.rank,
                groupName: r.groupName,
                points: r.points,
                pointsText: r.pointsText
            })),
            scrapedAt: now,
            timestamp: now.getTime() // Add timestamp for easier comparison
        };

        const db = client.db(dbName);
        const col = db.collection(collectionName);

        // Keep multiple snapshots per day for comparison, but limit to recent ones
        // Remove snapshots older than 7 days
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        await col.deleteMany({ scrapedAt: { $lt: sevenDaysAgo } });
        
        // Insert new snapshot
        await col.insertOne(doc);

        console.log(`[circle][save] saved ${rankings.length} circle rankings for ${snapshotDate}`);
        return true;
    } catch (e) {
        console.error('[circle][save] error saving to MongoDB:', e.message);
        return false;
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (e) {
                console.log('[circle][save] error closing MongoDB connection:', e.message);
            }
        }
    }
}

async function buildCircleRankingEmbeds(rankings, previousRankings = null, isFirstOfDay = false) {
    if (!rankings || rankings.length === 0) {
        return [
            {
                title: 'Circle Rankings - Top 100',
                description: 'No circle rankings found or failed to scrape.',
                color: 0xff0000,
            },
        ];
    }

    // Sort by points (highest first), then by group name for ties
    const sorted = rankings.sort((a, b) => {
        if (b.points !== a.points) {
            return b.points - a.points;
        }
        return a.groupName.localeCompare(b.groupName);
    });

    // Create a map of previous rankings for comparison
    const prevMap = new Map();
    if (previousRankings && previousRankings.length > 0) {
        const prevSorted = previousRankings.sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points;
            }
            return a.groupName.localeCompare(b.groupName);
        });
        prevSorted.forEach((r, index) => {
            prevMap.set(r.groupName, { 
                rank: index + 1, 
                points: r.points 
            });
        });
    }

    // Format rankings into lines with comparison indicators
    const lines = sorted.map((r, index) => {
        const currentRank = index + 1;
        const rankStr = currentRank.toString().padStart(2, '0');
        
        let changeIndicator = '';
        let pointsChangeIndicator = '';
        
        if (prevMap.has(r.groupName)) {
            const prev = prevMap.get(r.groupName);
            const rankChange = prev.rank - currentRank;
            const pointsChange = r.points - prev.points;
            
            if (rankChange > 0) {
                changeIndicator = ` ⬆️${rankChange}`;
            } else if (rankChange < 0) {
                changeIndicator = ` ⬇️${Math.abs(rankChange)}`;
            } else {
                changeIndicator = ' ➖';
            }
            
            if (pointsChange > 0) {
                pointsChangeIndicator = ` (+${pointsChange.toLocaleString()})`;
            } else if (pointsChange < 0) {
                pointsChangeIndicator = ` (${pointsChange.toLocaleString()})`;
            }
        } else {
            changeIndicator = ' 🆕'; // New entry
        }
        
        return `\`${rankStr}.\` **${r.groupName}** — ${r.points.toLocaleString()} PT${pointsChangeIndicator}${changeIndicator}`;
    });

    // Split into chunks to fit Discord embed limits
    // Use conservative limits: 30 lines per embed or 3000 chars, whichever comes first
    const MAX_CHARS = 3000;
    const MAX_LINES = 30;
    const chunks = [];
    let current = [];
    let currentLen = 0;
    
    for (const line of lines) {
        // Check if adding this line would exceed limits
        const wouldExceedChars = currentLen + line.length + 1 > MAX_CHARS;
        const wouldExceedLines = current.length >= MAX_LINES;
        
        if ((wouldExceedChars || wouldExceedLines) && current.length > 0) {
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

    const hasComparison = previousRankings && previousRankings.length > 0;
    const comparisonText = hasComparison ? ' • ⬆️⬇️ vs last update' : '';
    const now = new Date();
    
    // Create dividers based on whether this is the first update of the day
    const isDailyUpdate = isFirstOfDay;
    const divider = isDailyUpdate 
        ? '═══════════════════════════════════════════════════════════════'
        : '───────────────────────────────────────────────────────────────';
    
    const dividerText = isDailyUpdate 
        ? '🌅 **DAILY CIRCLE RANKINGS UPDATE** 🌅\n📊 **Complete Top 100 Circle Rankings** 📊'
        : '⏰ **30-MINUTE UPDATE** ⏰';

    console.log(`[circle][embeds] created ${chunks.length} embeds for ${sorted.length} rankings`);
    chunks.forEach((chunk, idx) => {
        const lineCount = chunk.split('\n').length;
        console.log(`[circle][embeds] embed ${idx + 1}: ${lineCount} lines, ${chunk.length} chars`);
    });

    return chunks.map((desc, idx) => {
        // Add divider only to the first embed
        const finalDescription = idx === 0 
            ? `${divider}\n${dividerText}\n${divider}\n\n${desc}`
            : desc;

        return {
            title: idx === 0 ? 'Circle Rankings - Top 100' : `Circle Rankings (cont. ${idx + 1})`,
            description: finalDescription,
            color: isDailyUpdate ? 0xffd700 : 0x7289da, // Gold for daily, blue for regular
            footer: {
                text: `Total: ${sorted.length} circles • Updated: ${now.toLocaleString()}${comparisonText}`
            }
        };
    });
}

async function getPreviousCircleRankings() {
    // Try different MongoDB URIs for Docker vs local environments
    const mongoUris = [
        config.MONGO_URI, // Docker URI: mongodb://mongodb:27017/mydatabase
        'mongodb://localhost:27017/mydatabase', // Local URI
        'mongodb://127.0.0.1:27017/mydatabase'  // Alternative local URI
    ];
    
    let client = null;
    let connected = false;
    
    for (const uri of mongoUris) {
        try {
            client = new MongoClient(uri);
            await client.connect();
            // Test the connection
            await client.db('mydatabase').admin().ping();
            connected = true;
            break;
        } catch (e) {
            if (client) {
                try { await client.close(); } catch (err) {}
                client = null;
            }
        }
    }
    
    if (!connected || !client) {
        console.log('[circle][prev] could not connect to MongoDB for previous rankings');
        return null;
    }
    
    try {
        const db = client.db('mydatabase');
        const collection = db.collection('circle_rankings');
        
        // Get the second most recent snapshot (the one before the current scrape)
        const snapshots = await collection
            .find({})
            .sort({ scrapedAt: -1 })
            .limit(2)
            .toArray();
        
        // Return the second most recent if we have at least 2 snapshots
        return (snapshots.length >= 2) ? snapshots[1].rankings : null;
    } catch (e) {
        console.log('[circle][prev] error getting previous rankings:', e.message);
        return null;
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (e) {}
        }
    }
}

async function isFirstUpdateOfDay() {
    // Try different MongoDB URIs for Docker vs local environments
    const mongoUris = [
        config.MONGO_URI, // Docker URI: mongodb://mongodb:27017/mydatabase
        'mongodb://localhost:27017/mydatabase', // Local URI
        'mongodb://127.0.0.1:27017/mydatabase'  // Alternative local URI
    ];
    
    let client = null;
    let connected = false;
    
    for (const uri of mongoUris) {
        try {
            client = new MongoClient(uri);
            await client.connect();
            // Test the connection
            await client.db('mydatabase').admin().ping();
            connected = true;
            break;
        } catch (e) {
            if (client) {
                try { await client.close(); } catch (err) {}
                client = null;
            }
        }
    }
    
    if (!connected || !client) {
        console.log('[circle][daily] could not connect to MongoDB for daily check');
        return false;
    }
    
    try {
        const db = client.db('mydatabase');
        const collection = db.collection('circle_rankings');
        
        // Check if there's any update today
        const today = getCalendarDayUTC(new Date());
        const todayUpdates = await collection
            .countDocuments({ snapshotDate: today });
        
        console.log(`[circle][daily] found ${todayUpdates} updates for ${today}`);
        return todayUpdates === 0; // First update if no updates today
    } catch (e) {
        console.log('[circle][daily] error checking daily updates:', e.message);
        return false;
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (e) {}
        }
    }
}

function hasSignificantChanges(currentRankings, previousRankings) {
    if (!previousRankings || previousRankings.length === 0) {
        console.log('[circle][changes] no previous data, considering as significant change');
        return true; // First run or no previous data
    }
    
    if (currentRankings.length !== previousRankings.length) {
        console.log('[circle][changes] different number of rankings, significant change detected');
        return true; // Different number of entries
    }
    
    // Create maps for easier comparison
    const currentMap = new Map();
    const previousMap = new Map();
    
    // Sort both by points for fair comparison
    const currentSorted = currentRankings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.groupName.localeCompare(b.groupName);
    });
    
    const previousSorted = previousRankings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.groupName.localeCompare(b.groupName);
    });
    
    currentSorted.forEach((r, index) => {
        currentMap.set(r.groupName, { rank: index + 1, points: r.points });
    });
    
    previousSorted.forEach((r, index) => {
        previousMap.set(r.groupName, { rank: index + 1, points: r.points });
    });
    
    let changesDetected = 0;
    let pointsChanges = 0;
    let rankChanges = 0;
    
    // Check for changes in existing teams
    for (const [groupName, current] of currentMap) {
        const previous = previousMap.get(groupName);
        if (previous) {
            if (current.points !== previous.points) {
                pointsChanges++;
                changesDetected++;
            }
            if (current.rank !== previous.rank) {
                rankChanges++;
                changesDetected++;
            }
        } else {
            // New team
            changesDetected++;
        }
    }
    
    // Check for removed teams
    for (const groupName of previousMap.keys()) {
        if (!currentMap.has(groupName)) {
            changesDetected++;
        }
    }
    
    console.log(`[circle][changes] detected ${changesDetected} total changes (${pointsChanges} points, ${rankChanges} ranks)`);
    
    // Consider significant if there are any changes
    return changesDetected > 0;
}

async function run(opts = {}) {
    const forceWebhook = opts.sendWebhook === true; // Explicit true forces webhook
    const doSave = opts.saveToMongo ?? true;
    const webhookUrl = config.CIRCLE_WEBHOOK_URL; // Use dedicated circle ranking webhook

    console.log('[circle] starting circle ranking scrape');

    try {
        const result = await loginAndScrapeCircleRanking();
        
        if (result.maintenance) {
            console.log('[circle] maimai is in maintenance, skipping scrape');
            if (forceWebhook) {
                const maintenanceEmbed = [{
                    title: 'Circle Rankings - Maintenance',
                    description: 'maimai is currently in maintenance (3:00 AM - 6:00 AM MYT). Scraping will resume after maintenance.',
                    color: 0xffa500,
                    footer: {
                        text: `Checked at: ${new Date().toLocaleString()}`
                    }
                }];
                await sendToWebhook(webhookUrl, maintenanceEmbed);
            }
            return { ok: true, maintenance: true, rankingsCount: 0 };
        }
        
        if (result.error) {
            console.error('[circle] error occurred during scraping');
            if (forceWebhook) {
                const errorEmbed = [{
                    title: 'Circle Rankings - Error',
                    description: 'Failed to scrape circle rankings. This may be due to login issues or site changes.',
                    color: 0xff0000,
                    footer: {
                        text: `Error at: ${new Date().toLocaleString()}`
                    }
                }];
                await sendToWebhook(webhookUrl, errorEmbed);
            }
            return { ok: false, error: 'scraping failed', rankingsCount: 0 };
        }

        const rankings = result.rankings;
        
        // Always get previous rankings for comparison
        let previousRankings = null;
        let isFirstOfDay = false;
        if (rankings.length > 0) {
            previousRankings = await getPreviousCircleRankings();
            isFirstOfDay = await isFirstUpdateOfDay();
        }
        
        // Always save to MongoDB first
        if (doSave) {
            await saveCircleRankingSnapshot(rankings);
        }
        
        // Check if there are significant changes
        const hasChanges = hasSignificantChanges(rankings, previousRankings);
        const shouldSendWebhook = forceWebhook || hasChanges;
        let sentWebhook = false;
        
        if (shouldSendWebhook && rankings.length > 0) {
            console.log(`[circle][webhook] sending to Discord (forced: ${forceWebhook}, changes: ${hasChanges}, firstOfDay: ${isFirstOfDay})`);
            
            const embeds = await buildCircleRankingEmbeds(rankings, previousRankings, isFirstOfDay);
            
            // Discord webhook limit: 10 embeds per message
            const MAX_EMBEDS_PER_MESSAGE = 10;
            
            for (let i = 0; i < embeds.length; i += MAX_EMBEDS_PER_MESSAGE) {
                const embedChunk = embeds.slice(i, i + MAX_EMBEDS_PER_MESSAGE);
                console.log(`[circle][webhook] sending ${embedChunk.length} embeds (${i + 1}-${i + embedChunk.length} of ${embeds.length})`);
                await sendToWebhook(webhookUrl, embedChunk);
                
                // Small delay between messages if sending multiple batches
                if (i + MAX_EMBEDS_PER_MESSAGE < embeds.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            sentWebhook = true;
        } else if (!shouldSendWebhook) {
            console.log('[circle][webhook] no significant changes detected, skipping Discord notification');
        }
        
        return { 
            ok: true, 
            rankingsCount: rankings.length,
            hasChanges,
            sentWebhook
        };
    } catch (e) {
        console.error('Error in circle ranking scraper:', e);
        return { ok: false, error: String(e) };
    }
}

if (require.main === module) {
    run()
        .then((result) => {
            console.log('[circle] scrape completed:', result);
            process.exit(0);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { run };