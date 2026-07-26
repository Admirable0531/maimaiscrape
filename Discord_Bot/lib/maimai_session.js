const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Shared Puppeteer login/session handling for maimai DX NET.
 *
 * friends_webhook.js and circle_ranking_scraper.js each carried their own
 * ~200-line copy of this (browser launch, agree checkbox, Sega ID login via
 * both the gateway and legacy flows, error-page detection, UA retry loop).
 * Behaviour here is kept identical to those copies; only the duplication is gone.
 */

const HEADLESS = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0';
const SCREENSHOT_DEBUG = process.env.SCREENSHOT_DEBUG === '1' || process.env.SCREENSHOT_DEBUG === 'true';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || 'screenshots';

const FALLBACK_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
const ALT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

const HOME_URL = 'https://maimaidx-eng.com';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeScreenshotter(prefix) {
    return async function debugScreenshot(page, stepName) {
        if (!SCREENSHOT_DEBUG || !page) return;
        try {
            if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const file = path.join(SCREENSHOT_DIR, `${prefix}_${stepName}_${ts}.png`);
            await page.screenshot({ path: file });
            console.log(`[${prefix}][screenshot] ${file}`);
        } catch (err) {
            console.log(`[${prefix}][screenshot] failed:`, err.message);
        }
    };
}

/** Resolves the Chromium binary. On ARM the bundled Puppeteer browser is x86 and won't run. */
function resolveExecutablePath(label) {
    let executablePath = config.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    const isArmLinux = process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64');

    if (!executablePath && isArmLinux) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    if (executablePath) {
        console.log(`[${label}] using browser:`, executablePath);
    } else if (isArmLinux) {
        console.log(
            `[${label}] no system Chromium found. On ARM the bundled browser is x86 and will fail. ` +
                'Install chromium or set CHROME_EXECUTABLE_PATH / PUPPETEER_EXECUTABLE_PATH.'
        );
    }
    return executablePath;
}

async function clickVisibleAgreeCheckbox(page, label) {
    const selector = 'input.c-form__checkbox.js-agree';
    try {
        await delay(200);
        const inputs = await page.$$(selector);

        // The second checkbox is the maimai DX one; try it first, then the rest.
        const order = inputs.length >= 2 ? [inputs[1], inputs[0], ...inputs.slice(2)] : [...inputs];

        for (let i = 0; i < order.length; i++) {
            const el = order[i];
            if (!(await el.boundingBox())) continue;
            try {
                await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
            } catch {}
            try {
                await el.click({ delay: 50 });
                console.log(`[${label}][agree] clicked checkbox index ${i} (ordered)`);
                return true;
            } catch {
                try {
                    await page.evaluate((e) => e.click(), el);
                    console.log(`[${label}][agree] clicked checkbox index ${i} via JS click`);
                    return true;
                } catch {}
            }
        }
    } catch {}

    // Fallback: the label wrapping the checkbox.
    try {
        const parent = await page.$('#agree-maimaidxex');
        const label_ = parent && (await parent.$('label'));
        if (label_) {
            try {
                await label_.click();
                return true;
            } catch {
                await page.evaluate((el) => el.click(), label_);
                return true;
            }
        }
    } catch {}

    console.log(`[${label}][agree] could not find a visible agree checkbox`);
    return false;
}

/** True when SEGA served its generic ERROR/Aime failure page instead of the site. */
async function isErrorPage(page, label) {
    try {
        const title = (await page.title()) || '';
        const content = await page.content();
        const hasErrorTitle = title.toUpperCase().includes('ERROR');
        const hasAimeError = content.includes('Aime service site') && content.includes('Error');
        const hasNoScript = content.includes('Please enable JavaScript and CSS');
        const hasErrEl = !!(await page.$('#error-ui'));

        if (hasErrorTitle || hasAimeError || hasErrEl || hasNoScript) {
            console.log(
                `[${label}][isErrorPage] true`,
                JSON.stringify({ url: page.url(), title, hasErrorTitle, hasAimeError, hasErrEl, hasNoScript })
            );
            return true;
        }
    } catch {}
    return false;
}

/** Fills the Sega ID form and submits it. Used by both the gateway and legacy flows. */
async function submitCredentials(page, { sid: user, password: pass }, label, shot, attempt) {
    const sid = await page.waitForSelector('#sid', { timeout: 20000 });
    console.log(`[${label}] sid input found, typing user`);
    await shot(page, `03_before_sid_type_attempt${attempt}`);
    await sid.click({ clickCount: 3 });
    await sid.type(user || '', { delay: 50 });

    let pwdTyped = false;
    try {
        const pwd = await page.waitForSelector('#password', { timeout: 20000 });
        try {
            await pwd.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        } catch {}
        try {
            await pwd.click({ clickCount: 3 });
        } catch {}
        try {
            await pwd.type(pass || '', { delay: 50 });
            pwdTyped = true;
        } catch (err) {
            console.log(`[${label}] pwd.type failed, will fall back to JS set:`, err.message);
        }
    } catch (err) {
        console.log(`[${label}] #password not found, trying generic password input:`, err.message);
        try {
            await page.type('input[type="password"]', pass || '', { delay: 50 });
            pwdTyped = true;
        } catch (err2) {
            console.log(`[${label}] generic password type failed:`, err2.message);
        }
    }

    if (!pwdTyped && pass) {
        await page.evaluate((value) => {
            const input = document.querySelector('#password') || document.querySelector('input[type="password"]');
            if (input) input.value = value;
        }, pass);
        console.log(`[${label}] password set via JS value`);
    }
    await shot(page, `04_after_pwd_attempt${attempt}`);
}

/** Logs in, handling both the Aime gateway landing and the legacy home-page flow. */
async function login(page, credentials, label, shot, attempt) {
    const onGateway = page.url().includes('common_auth/login');

    try {
        const segaBtn = await page.waitForSelector('.c-button--openid--segaId', { timeout: 10000 });
        console.log(`[${label}] Sega login button found, clicking`);
        await shot(page, `02_before_sega_click_attempt${attempt}`);
        await segaBtn.click();
        await clickVisibleAgreeCheckbox(page, label);
        await delay(500 + Math.random() * 1000);
        await shot(page, `03_after_sega_click_attempt${attempt}`);
    } catch (err) {
        console.log(`[${label}] Sega login button not present; continuing. url =`, page.url());
        if (!onGateway) return;
    }

    try {
        await submitCredentials(page, credentials, label, shot, attempt);

        if (onGateway) {
            // The gateway sometimes lacks a .c-button--login element; submit the form directly.
            console.log(`[${label}] submitting login form via JS`);
            await page.evaluate(() => {
                const form =
                    document.querySelector('form[name="loginForm"]') ||
                    document.querySelector('form[action*="common_auth/login"]') ||
                    document.querySelector('form');
                if (form) form.submit();
            });
            try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
            } catch (err) {
                console.log(`[${label}] waitForNavigation after login timed out:`, err.message);
            }
        } else {
            const loginBtn = await page.waitForSelector('.c-button--login', { timeout: 10000 });
            await loginBtn.click();
            await delay(1000 + Math.random() * 1000);
        }
        console.log(`[${label}] after login submit, url =`, page.url(), 'title =', await page.title());
        await shot(page, `05_after_login_attempt${attempt}`);
    } catch (err) {
        console.log(`[${label}] login inputs not found or already logged in:`, err.message);
    }
}

/**
 * Runs `task(page, browser)` inside a logged-in maimai session.
 *
 * Tries each user agent in turn; if SEGA answers with its ERROR page after
 * login the browser is torn down and the next UA is tried. The browser is
 * always closed, including on throw — the previous copies could leak one on
 * some paths.
 *
 * Returns whatever `task` returns, or `fallback` if every attempt failed.
 */
async function withMaimaiSession({ credentials, label, task, fallback = null }) {
    const shot = makeScreenshotter(label);
    const executablePath = resolveExecutablePath(label);
    const envUa = (process.env.USER_AGENT || '').trim();
    const userAgents = [envUa || FALLBACK_UA, ALT_UA];

    if (!HEADLESS) console.log(`[${label}] running with a visible browser (HEADLESS=false)`);

    for (let attempt = 1; attempt <= userAgents.length; attempt++) {
        const ua = userAgents[attempt - 1];
        console.log(`[${label}][attempt ${attempt}] using UA: ${ua}`);
        let browser = null;
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

            await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
            console.log(`[${label}] home loaded, url =`, page.url(), 'title =', await page.title());
            await shot(page, `01_home_attempt${attempt}`);

            await login(page, credentials, label, shot, attempt);

            if (await isErrorPage(page, label)) {
                await shot(page, `06_error_attempt${attempt}`);
                console.log(`[${label}][attempt ${attempt}] SEGA returned an ERROR page after login; retrying`);
                continue;
            }

            return await task(page, browser, { shot, label });
        } catch (err) {
            console.log(`[${label}] unhandled exception during attempt ${attempt}:`, err.message);
        } finally {
            if (browser) {
                await browser.close().catch((err) => console.log(`[${label}] browser close failed:`, err.message));
            }
        }
    }

    console.log(`[${label}] all ${userAgents.length} attempts failed`);
    return fallback;
}

module.exports = {
    withMaimaiSession,
    isErrorPage,
    clickVisibleAgreeCheckbox,
    makeScreenshotter,
    resolveExecutablePath,
    delay,
    HEADLESS,
    SCREENSHOT_DEBUG,
    HOME_URL,
    FALLBACK_UA,
    ALT_UA,
};
