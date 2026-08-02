const { chromium } = require('playwright');
const fs = require('fs');
const { assertSafeUrl } = require('./urlSafety');
const logger = require('../utils/logger');

// Playwright's own bundled Chromium build doesn't support arm64 Debian
// (confirmed live: "Playwright does not support chromium on debian11-arm64"
// on the Pi) — same problem Discord_Bot/lib/maimai_session.js already solves
// for its Puppeteer browser, so resolve the system Chromium apt installs the
// same way that file does, rather than relying on Playwright's downloader.
function resolveExecutablePath() {
    let executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const isArmLinux = process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64');
    if (!executablePath && isArmLinux) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    return executablePath;
}

// Login flow ported from Discord_Bot/lib/maimai_session.js (Puppeteer,
// proven working against the real site for the nightly scrapers) to
// Playwright's Locator API. Unlike that file this only ever needs ONE
// account logged in at a time, kept warm as a shared session instead of a
// fresh login per call — logging in on every tool call would be slow and
// is the kind of repeated-auth pattern that gets accounts flagged.
const HOME_URL = 'https://maimaidx-eng.com';
const ALLOWED_PATH_PREFIX = '/maimai-mobile/';
// Exported so pageLoader.js can recognize these URLs and route them here
// instead of the generic fetch/Playwright pipeline, without duplicating the
// host/prefix strings in two files.
const MAIMAI_ACCOUNT_HOST = 'maimaidx-eng.com';
const MAIMAI_ACCOUNT_PATH_PREFIX = ALLOWED_PATH_PREFIX;
const NAV_TIMEOUT_MS = 30000;
// Same reasoning as playwrightFetcher.js's IDLE_TIMEOUT_MS — a resident
// Chromium process is real RAM on a Pi 4; auto-close after inactivity and
// pay a relogin on the next call instead of holding it open indefinitely.
const IDLE_TIMEOUT_MS = Number(process.env.MAIMAI_ACCOUNT_IDLE_TIMEOUT_MS) || 5 * 60 * 1000;
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

const SID = process.env.MAIMAI_LOGIN_SID || '';
const PASSWORD = process.env.MAIMAI_LOGIN_PASSWORD || '';

let contextPromise = null;
let idleTimer = null;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

function scheduleIdleClose() {
    if (IDLE_TIMEOUT_MS <= 0) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
        closeSession().catch((err) => logger.error('web', 'Error auto-closing idle maimai account session', err));
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
}

/** True when SEGA served its generic ERROR/Aime failure page instead of the site (same signature as maimai_session.js's isErrorPage). */
async function isErrorPage(page) {
    try {
        const title = (await page.title()) || '';
        const content = await page.content();
        return (
            title.toUpperCase().includes('ERROR') ||
            (content.includes('Aime service site') && content.includes('Error')) ||
            content.includes('Please enable JavaScript and CSS') ||
            // maimai-mobile's own session-expired page ("ERROR CODE：200004 /
            // An error occured. / Please login again.") — confirmed live
            // that hitting this on ANY page poisons every subsequent page
            // load in the same session, not just the one that triggered it.
            content.includes('ERROR CODE') ||
            content.includes('Please login again') ||
            (await page.locator('#error-ui').count()) > 0
        );
    } catch {
        return false;
    }
}

// Confirmed live: a direct GET to either of these kills the ENTIRE session
// (every page load after it fails identically until a fresh login), not
// just the request itself — block them outright rather than relying on
// isErrorPage's relogin-and-retry to recover after the fact.
const BLOCKED_PATHS = new Set(['/maimai-mobile/home/ratingTargetMusic/', '/maimai-mobile/home/serialcode/']);

async function clickAgreeCheckbox(page) {
    const boxes = page.locator('input.c-form__checkbox.js-agree');
    const count = await boxes.count().catch(() => 0);
    if (count === 0) return false;

    // The second checkbox is the maimai DX one; try it first, then the rest.
    const order = count >= 2 ? [1, 0, ...Array.from({ length: count - 2 }, (_, i) => i + 2)] : [0];
    for (const i of order) {
        const box = boxes.nth(i);
        try {
            if (!(await box.isVisible().catch(() => false))) continue;
            await box.scrollIntoViewIfNeeded().catch(() => {});
            await box.click({ timeout: 2000 });
            return true;
        } catch {}
    }
    return false;
}

/** Logs in, handling both the Aime gateway landing and the legacy home-page flow. */
async function login(page) {
    if (!SID || !PASSWORD) {
        throw new Error('MAIMAI_LOGIN_SID / MAIMAI_LOGIN_PASSWORD are not set.');
    }

    await page.goto(HOME_URL, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    const onGateway = page.url().includes('common_auth/login');

    const segaBtn = page.locator('.c-button--openid--segaId').first();
    if ((await segaBtn.count().catch(() => 0)) > 0) {
        await segaBtn.click({ timeout: 10000 }).catch(() => {});
        await clickAgreeCheckbox(page);
        await delay(500 + Math.random() * 1000);
    } else if (!onGateway) {
        return; // no Sega login button and not on the gateway -> most likely already logged in
    }

    const sidField = page.locator('#sid').first();
    if ((await sidField.count().catch(() => 0)) === 0) return; // login form never appeared

    await sidField.click({ clickCount: 3 }).catch(() => {});
    await sidField.fill(SID, { timeout: 20000 });

    const pwdField = page.locator('#password, input[type="password"]').first();
    if ((await pwdField.count().catch(() => 0)) > 0) {
        try {
            await pwdField.click({ clickCount: 3 }).catch(() => {});
            await pwdField.fill(PASSWORD, { timeout: 20000 });
        } catch {
            await page.evaluate((value) => {
                const input = document.querySelector('#password') || document.querySelector('input[type="password"]');
                if (input) input.value = value;
            }, PASSWORD);
        }
    }

    if (onGateway) {
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(() => {}),
            page.evaluate(() => {
                const form =
                    document.querySelector('form[name="loginForm"]') ||
                    document.querySelector('form[action*="common_auth/login"]') ||
                    document.querySelector('form');
                if (form) form.submit();
            }),
        ]);
    } else {
        const loginBtn = page.locator('.c-button--login').first();
        if ((await loginBtn.count().catch(() => 0)) > 0) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(() => {}),
                loginBtn.click(),
            ]);
        }
    }

    if (await isErrorPage(page)) {
        throw new Error('SEGA login failed (error page returned) — check MAIMAI_LOGIN_SID/MAIMAI_LOGIN_PASSWORD.');
    }
}

function getContext() {
    clearIdleTimer(); // in active use — cancel any pending auto-close
    if (!contextPromise) {
        contextPromise = (async () => {
            const executablePath = resolveExecutablePath();
            if (executablePath) logger.info('web', 'maimai account session using browser', { executablePath });
            const browser = await chromium.launch({
                headless: true,
                args: ['--disable-dev-shm-usage'],
                ...(executablePath ? { executablePath } : {}),
            });
            const context = await browser.newContext({ userAgent: USER_AGENT });
            const page = await context.newPage();
            try {
                await login(page);
            } finally {
                await page.close();
            }
            return context;
        })().catch((err) => {
            contextPromise = null; // don't cache a failed login attempt
            throw err;
        });
    }
    return contextPromise;
}

async function closeSession() {
    clearIdleTimer();
    if (!contextPromise) return;
    const context = await contextPromise.catch(() => null);
    contextPromise = null;
    if (context) {
        await context.browser()?.close().catch((err) => logger.error('web', 'Error closing maimai account session', err));
    }
}

/**
 * Loads a maimai-mobile page within the authenticated session and returns
 * its rendered HTML + final URL. `path` must start with /maimai-mobile/ —
 * this deliberately never navigates anywhere else, since the whole point is
 * reusing one account's login cookies for maimai-mobile pages specifically,
 * not operating as a general authenticated browser.
 */
async function fetchAccountPage(path) {
    if (typeof path !== 'string' || !path.startsWith(ALLOWED_PATH_PREFIX)) {
        throw new Error(`Only paths under ${ALLOWED_PATH_PREFIX} are allowed.`);
    }
    if (BLOCKED_PATHS.has(path)) {
        throw new Error(`${path} is known to break the login session for every page after it — not fetchable.`);
    }
    const url = new URL(path, HOME_URL).toString();
    await assertSafeUrl(url); // defense in depth even though the host is fixed

    const load = async () => {
        const context = await getContext();
        const page = await context.newPage();
        try {
            const response = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
            if (!response) throw new Error('Navigation failed (no response).');
            const loggedOut = await isErrorPage(page);
            const html = await page.content();
            const finalUrl = page.url();
            return { html, finalUrl, loggedOut };
        } finally {
            await page.close();
            scheduleIdleClose();
        }
    };

    let result = await load();
    if (result.loggedOut) {
        // Session likely expired mid-conversation — relogin once and retry
        // this single page load, rather than surfacing a confusing error
        // for something a fresh login would silently fix.
        logger.warn('web', 'maimai account session looked logged-out, relogging in and retrying once');
        await closeSession();
        result = await load();
        if (result.loggedOut) {
            throw new Error('Still logged out after a fresh login attempt — SEGA may have rejected the credentials.');
        }
    }

    return { html: result.html, finalUrl: result.finalUrl };
}

module.exports = { fetchAccountPage, closeSession, MAIMAI_ACCOUNT_HOST, MAIMAI_ACCOUNT_PATH_PREFIX };
