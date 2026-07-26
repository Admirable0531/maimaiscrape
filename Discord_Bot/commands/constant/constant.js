const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../../config');
const { chunkLines } = require('../../lib/format');

puppeteer.use(StealthPlugin());

// Credentials come from the same .env the rest of the bot uses. The previous
// dotenv path here resolved to Discord_Bot/commands/.env, which does not exist,
// so local (non-Docker) runs had no login at all.
const MAIMAI_USER = process.env.MAIMAI_USER;
const MAIMAI_PASS = process.env.MAIMAI_PASS;

const LOGIN_URL = 'https://maimaidx-eng.com';
const SCORE_SELECTOR = '.music_master_score_back, .music_remaster_score_back';
const MAI_TOOLS_SRC = 'https://myjian.github.io/mai-tools/scripts/all-in-one.js';

/** Extra wait before navigating, to look less like a bot. Was a hardcoded 40s. */
const PRE_NAV_DELAY_MS = parseInt(process.env.CONSTANT_PRE_NAV_DELAY_MS || '5000', 10);
/** Time allowed for the injected mai-tools script to annotate the page. */
const MAI_TOOLS_SETTLE_MS = 3000;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function capitalizeFirstLetter(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** maimai groups constants into level buckets; this maps a constant to its bucket id. */
function calculateLevel(constantValue) {
    const value = parseFloat(constantValue);
    if (value >= 14.0 && value <= 14.5) return 21;
    if (value >= 14.6 && value <= 14.9) return 22;
    if (value === 15.0) return 23;
    return 0;
}

/** Injects mai-tools, which adds the data-inlv chart-constant attributes we read. */
function injectMaiTools(page) {
    return page.evaluate((scriptSrc) => {
        return new Promise((resolve) => {
            if (!['https://maimaidx.jp', 'https://maimaidx-eng.com'].includes(window.location.origin)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = `${scriptSrc}?t=${Math.floor(Date.now() / 60000)}`;
            script.onload = resolve;
            script.onerror = resolve; // don't hang if the CDN is unreachable
            document.body.appendChild(script);
        });
    }, MAI_TOOLS_SRC);
}

/**
 * Reads every Master/Re:Master chart on the page whose constant matches.
 * `percentSelector` differs between the friend-versus page and one's own record page.
 */
function extractSongs(page, constantValue, percentSelector) {
    return page.$$eval(
        SCORE_SELECTOR,
        (blocks, targetConstant, percentSel) =>
            blocks
                .map((block) => {
                    const levelEl = block.querySelector('.music_lv_block.f_r.t_c.f_14');
                    if (!levelEl) return null;
                    if ((levelEl.getAttribute('data-inlv') || 'N/A') !== targetConstant) return null;

                    const name =
                        block.querySelector('.music_name_block.t_l.f_13.break')?.textContent.trim() || 'Unknown';
                    const difficulty = block.classList.contains('music_remaster_score_back') ? 'ReMAS' : 'MAS';

                    let percentage = 'N/A';
                    if (percentSel === 'versus') {
                        const scores = block.querySelectorAll('.w_120.f_b');
                        if (scores.length > 1) percentage = scores[1].textContent.trim();
                    } else {
                        percentage =
                            block.querySelector('.music_score_block.w_112.t_r.f_l.f_12')?.textContent.trim() ||
                            'N/A';
                    }
                    return [name, difficulty, percentage];
                })
                .filter(Boolean),
        constantValue,
        percentSelector
    );
}

async function login(page) {
    await page.goto(LOGIN_URL);
    await page.waitForSelector('#agree', { visible: true, timeout: 10000 });
    await page.click('.c-form__checkbox');
    await page.click('.c-button--openid--segaId');
    await page.waitForSelector('#sid', { visible: true, timeout: 10000 });
    await page.type('#sid', MAIMAI_USER);
    await page.waitForSelector('#password', { visible: true, timeout: 10000 });
    await page.type('#password', MAIMAI_PASS);
    await page.waitForSelector('.c-button--login', { visible: true, timeout: 10000 });
    await page.click('.c-button--login');
    await page.waitForSelector('.comment_block', { visible: true });
}

/**
 * Scrapes charts at `constantValue`, either from a friend's versus page (when
 * `friendIdx` is set) or from the logged-in account's own record page.
 */
async function scrapeConstant(constantValue, friendIdx) {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',
            '--disable-software-rasterizer',
        ],
        timeout: 60000,
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.90 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        page.setDefaultNavigationTimeout(60000);

        if (PRE_NAV_DELAY_MS > 0) await delay(PRE_NAV_DELAY_MS);
        await login(page);

        const level = calculateLevel(constantValue);
        const targetUrl = friendIdx
            ? `https://maimaidx-eng.com/maimai-mobile/friend/friendLevelVs/battleStart/?scoreType=2&level=${level}&idx=${friendIdx}`
            : `https://maimaidx-eng.com/maimai-mobile/record/musicLevel/search/?level=${level}`;

        await page.goto(targetUrl);
        await page.waitForSelector('.footer_banner', { visible: true });
        await injectMaiTools(page);
        await delay(MAI_TOOLS_SETTLE_MS);

        return extractSongs(page, constantValue, friendIdx ? 'versus' : 'own');
    } finally {
        // Single close: the old code called browser.close() in catch *and*
        // twice more in finally.
        await browser.close().catch((err) => console.error('[constant] browser close failed:', err.message));
    }
}

/** Achievement percentages sort descending; missing/unplayed charts go last. */
function achievementValue(percentage) {
    if (!percentage || percentage === 'N/A' || percentage === '― %') return -Infinity;
    const parsed = parseFloat(percentage);
    return Number.isNaN(parsed) ? -Infinity : parsed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('constant')
        .setDescription('Get scores on difficulty constant')
        .addStringOption((option) =>
            option
                .setName('constant')
                .setDescription('The difficulty constant you want (14.0 - 15.0)')
                .setRequired(true)
        )
        .addStringOption((option) => option.setName('guy').setDescription('Whose scores to look up')),

    async execute(interaction) {
        await interaction.deferReply();

        const rawConstant = interaction.options.getString('constant');
        const parsedConstant = parseFloat(rawConstant);
        if (Number.isNaN(parsedConstant) || parsedConstant < 14.0 || parsedConstant > 15.0) {
            await interaction.editReply('Please provide a valid constant value (14.0 to 15.0)');
            return;
        }
        // maimai reports constants with one decimal, so "14" must become "14.0".
        const constantValue = parsedConstant.toFixed(1);

        if (!MAIMAI_USER || !MAIMAI_PASS) {
            await interaction.editReply('MAIMAI_USER / MAIMAI_PASS are not configured in .env.');
            return;
        }

        // `displayName` and `friendIdx` are locals. `man` used to be an implicit
        // global, so two people running /constant at once could each see the
        // other's name on their embed.
        const guy = interaction.options.getString('guy');
        let displayName = 'Azu';
        let friendIdx = null;

        if (guy) {
            const key = guy.toLowerCase();
            if (!config.checkConstant.includes(key)) {
                await interaction.editReply(`The name "${guy}" is not recognized.`);
                return;
            }
            displayName = capitalizeFirstLetter(key);
            // Look up with the normalised key: the old code validated the
            // lowercased name but indexed idxMap with the raw input, so "Marcus"
            // silently fell through to the logged-in account's own scores.
            friendIdx = config.idxMap[key] || null;
        }

        let songs;
        try {
            songs = await scrapeConstant(constantValue, friendIdx);
        } catch (err) {
            console.error('[constant] scrape failed:', err);
            await interaction.editReply('Failed to fetch scores from maimai DX NET. Check the bot logs.');
            return;
        }

        if (!songs || songs.length === 0) {
            await interaction.editReply(`No songs found for constant ${constantValue}`);
            return;
        }

        songs.sort((a, b) => achievementValue(b[2]) - achievementValue(a[2]));

        const lines = songs.map(([name, difficulty, percentage]) => `${name}: ${difficulty} - ${percentage}`);
        // A description over 4096 characters makes Discord reject the embed, so
        // long result sets are split across several.
        const chunks = chunkLines(lines, 4000);

        const embeds = chunks.map((description, index) =>
            new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(
                    index === 0
                        ? `${displayName}: Songs for Constant ${constantValue}`
                        : `${displayName}: Constant ${constantValue} (cont. ${index + 1})`
                )
                .setDescription(description)
        );

        await interaction.editReply({ embeds: embeds.slice(0, 10) });
        for (let i = 10; i < embeds.length; i += 10) {
            await interaction.followUp({ embeds: embeds.slice(i, i + 10) });
        }
    },
};
