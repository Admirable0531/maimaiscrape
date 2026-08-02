const { chromium } = require('playwright');
const fs = require('fs');
const { assertSafeUrl } = require('./urlSafety');
const logger = require('../utils/logger');

// Same arm64-Debian gap as maimaiAccountSession.js — see its own comment for
// the confirmed live error. Kept as a separate copy rather than a shared
// import since this file has no other dependency on that module.
function resolveExecutablePath() {
    let executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const isArmLinux = process.platform === 'linux' && (process.arch === 'arm' || process.arch === 'arm64');
    if (!executablePath && isArmLinux) {
        const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
        executablePath = candidates.find((p) => fs.existsSync(p));
    }
    return executablePath;
}

const NAV_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)';
// A resident Chromium process is easily 200-300MB+ of RAM — real weight on
// a Raspberry Pi 4. Auto-closing after a stretch of no use trades a small
// amount of relaunch latency on the next JS-fallback call (measured
// ~100-200ms of extra process-startup overhead vs. an already-warm browser
// — per-page navigation dominates the total either way) for not holding
// that memory the rest of the time. Set to 0 to keep the browser always warm.
const IDLE_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_IDLE_TIMEOUT_MS) || 5 * 60 * 1000;

let browserPromise = null;
let idleTimer = null;

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
        closeBrowser().catch((err) => logger.error('web', 'Error auto-closing idle Playwright browser', err));
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.(); // don't keep the process alive just for this timer
}

function getBrowser() {
    clearIdleTimer(); // in active use — cancel any pending auto-close
    if (!browserPromise) {
        const executablePath = resolveExecutablePath();
        browserPromise = chromium.launch({
            headless: true,
            // /dev/shm is often tiny on constrained/containerized Linux
            // (Raspberry Pi OS included) — Chromium's default shared-memory
            // usage there is a well-known crash source. This makes it use
            // /tmp instead; no effect on Windows/macOS. Sandboxing itself is
            // left on — that's a real security boundary, not something to
            // drop just because the device is small.
            args: ['--disable-dev-shm-usage'],
            ...(executablePath ? { executablePath } : {}),
        });
    }
    return browserPromise;
}

/**
 * Renders a page with a real (headless Chromium) browser — used only as a
 * fallback when the static fetch in webpageFetcher.js yields too little text
 * to be real content (a JS-rendered SPA shell). page.goto() does its own
 * networking outside our fetch()-based SSRF guard, and it follows redirects
 * and loads sub-resources (scripts, XHR, images) on its own, so every
 * request the browser makes — not just the initial navigation — is routed
 * through the same assertSafeUrl() check via page.route(), closing the gap
 * that would otherwise let this fallback bypass Phase 3's SSRF protection.
 */
async function fetchRendered(url) {
    await assertSafeUrl(url); // fail fast before even launching a page

    const browser = await getBrowser();
    const page = await browser.newPage({ userAgent: USER_AGENT });

    await page.route('**/*', async (route) => {
        try {
            await assertSafeUrl(route.request().url());
            await route.continue();
        } catch {
            await route.abort();
        }
    });

    try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        if (!response) throw new Error('Navigation failed (no response).');
        if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${response.statusText() || 'request failed'}`);

        const html = await page.content();
        return { html, finalUrl: page.url() };
    } finally {
        await page.close();
        scheduleIdleClose();
    }
}

async function closeBrowser() {
    clearIdleTimer();
    if (!browserPromise) return;
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
}

module.exports = { fetchRendered, closeBrowser };
