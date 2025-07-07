const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder  } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const user = process.env.MAIMAI_USER;
const pass = process.env.MAIMAI_PASS;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('constant')
		.setDescription('Get scores on difficulty constant')
        .addStringOption(option =>
			option
				.setName('constant')
				.setDescription('The difficulty constant you want')
				.setRequired(true))
        .addStringOption(option =>
            option
                .setName('guy')
                .setDescription('guy')),
	async execute(interaction) {
        await interaction.deferReply();
        let constantValue = interaction.options.getString('constant');
        if (!isNaN(constantValue) && constantValue >= 14.0 && constantValue <= 15.0) {
        } else {
            // The constantValue is invalid
            await interaction.editReply({ content: 'Please provide a valid constant value (14.0 to 15.0)', ephemeral: true });
            return;

        }
        
        function capitalizeFirstLetter(string) {
            return string.charAt(0).toUpperCase() + string.slice(1);
        }

        const guy = interaction.options.getString('guy');
        if(guy){
            if (!['klcc', 'marcus', 'yuan', 'keyang', 'yuchen', 'jerry', 'kok'].includes(guy.toLowerCase())) {
                await interaction.editReply(`The name "${guy}" is not recognized.`);
                return;
            }
            man = capitalizeFirstLetter(guy.toLowerCase());
        } else {
            man = "Azu";
        }
        const songs = await scrape();
        await songs.sort((a, b) => {
            const scoreA = (a[2] && a[2] !== "N/A" && a[2] !== "― %") ? parseFloat(a[2]) : -Infinity;
            const scoreB = (b[2] && b[2] !== "N/A" && b[2] !== "― %") ? parseFloat(b[2]) : -Infinity;
        
            return scoreB - scoreA; // Sort in descending order
        });
        
        if (songs && songs.length > 0) {
            // Join the songs into a single string and send as a response
            const songDescriptions = songs.map(song => `${song[0]}: ${song[1]} - ${song[2]}`).join('\n');
            const embed = new EmbedBuilder()
                .setColor('#0099ff') // Set the embed color (optional)
                .setTitle(man+ ': Songs for Constant ' + constantValue)
                .setDescription(songDescriptions); // Create a list of songs separated by newlines
            
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply(`No songs found for constant ${constantValue}`);
        }

        async function scrape() {
            const guy = interaction.options.getString('guy');
            const browser = await puppeteer.launch({
                
                executablePath: '/usr/bin/chromium', // Adjust this path if necessary
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        
            try {
                const page = await browser.newPage();
                await page.setUserAgent(
                    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.90 Safari/537.36"
                );
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9'
                });
                await page.goto('https://maimaidx-eng.com');
                await page.screenshot({ path: 'before_click.png' });

                await page.click('.c-button--openid--segaId');
                await page.screenshot({ path: 'after_click.png' });
        
                // Login process
                try {
                    await page.waitForSelector('#sid', { visible: true, timeout: 10000 });
                    await page.type('#sid', user);
                    await page.waitForSelector('#password', { visible: true, timeout: 10000 });
                    await page.type('#password', pass);
                } catch (error) {
                    console.error("Input element not found:", error);
                    throw error; // Ensure the error propagates
                }
        
                await page.waitForSelector('.c-button--login', { visible: true, timeout: 10000 });
                await page.click('.c-button--login');
                await page.waitForSelector('.comment_block', { visible: true });
        
                // Handle user-specific logic
                const idxMap = {
                    klcc: '4039890368767',
                    yuchen: '6020500221031',
                    marcus: '8071982688053',
                    kok: '8085423055111',
                    yuan: '8070962675681',
                    keyang: '8091021494559',
                    jerry: '6028368715803'
                };
        
                if (guy in idxMap) {
                    const idx = idxMap[guy];
                    await page.goto(`https://maimaidx-eng.com/maimai-mobile/friend/friendLevelVs/battleStart/?scoreType=2&level=${calculateLevel(constantValue)}&idx=${idx}`);
                    await page.waitForSelector('.footer_banner', { visible: true });
                    await page.evaluate(() => {
                        return new Promise((resolve) => {
                            if (["https://maimaidx.jp", "https://maimaidx-eng.com"].includes(window.location.origin)) {
                                const script = document.createElement("script");
                                script.src = "https://myjian.github.io/mai-tools/scripts/all-in-one.js?t=" + Math.floor(Date.now() / 60000);
                                script.onload = resolve; // Only resolve when script is fully loaded
                                document.body.appendChild(script);
                            } else {
                                resolve();
                            }
                        });
                    });
                    
                    if (/^\d+$/.test(constantValue)) {
                        constantValue = `${constantValue}.0`;
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const songList = await page.$$eval('.music_master_score_back, .music_remaster_score_back', (blocks, constantValue) => {
                        return blocks
                            .map(block => {
                                const musicName = block.querySelector('.music_name_block.t_l.f_13.break')?.textContent.trim() || "Unknown";
                                const inLvElement = block.querySelector('.music_lv_block.f_r.t_c.f_14');
                                const difficulty = block.classList.contains('music_remaster_score_back') ? "ReMAS" : "MAS";
                                const scoreElements = block.querySelectorAll('.w_120.f_b');
                                const percentage = scoreElements.length > 1 ? scoreElements[1].textContent.trim() : "N/A";
                    
                                if (!inLvElement) return null; // Skip if internal level is missing
                                
                                const inLv = inLvElement.getAttribute('data-inlv') || "N/A";
                                if (inLv == constantValue) {
                                    return [musicName, difficulty, percentage];
                                }
                    
                                return null; // Skip songs that don't match the target internal level
                            })
                            .filter(song => song !== null); // Remove null values
                    }, constantValue);
                    
                    return songList;
                } else {
                    // Azu
                    await page.goto(`https://maimaidx-eng.com/maimai-mobile/record/musicLevel/search/?level=${calculateLevel(constantValue)}`);
                    await page.waitForSelector('.footer_banner', { visible: true });

                    await page.evaluate(() => {
                        return new Promise((resolve) => {
                            if (["https://maimaidx.jp", "https://maimaidx-eng.com"].includes(window.location.origin)) {
                                const script = document.createElement("script");
                                script.src = "https://myjian.github.io/mai-tools/scripts/all-in-one.js?t=" + Math.floor(Date.now() / 60000);
                                script.onload = resolve; // Only resolve when script is fully loaded
                                document.body.appendChild(script);
                            } else {
                                resolve();
                            }
                        });
                    });
                    if (/^\d+$/.test(constantValue)) {
                        constantValue = `${constantValue}.0`;
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const songList = await page.$$eval('.music_master_score_back, .music_remaster_score_back', (blocks, constantValue) => {
                        return blocks
                            .map(block => {
                                const musicName = block.querySelector('.music_name_block.t_l.f_13.break')?.textContent.trim() || "Unknown";
                                const inLvElement = block.querySelector('.music_lv_block.f_r.t_c.f_14');
                                const difficulty = block.classList.contains('music_remaster_score_back') ? "ReMAS" : "MAS";
                                const percentage = block.querySelector('.music_score_block.w_112.t_r.f_l.f_12')?.textContent.trim() || "N/A";

                                if (!inLvElement) return null; // Skip if internal level is missing
                                
                                const inLv = inLvElement.getAttribute('data-inlv') || "N/A";

                                if (inLv == constantValue) {
                                    return [musicName, difficulty, percentage];
                                }
                    
                                return null; // Skip songs that don't match the target internal level
                            })
                            .filter(song => song !== null); // Remove null values
                    }, constantValue);
                    
                    return songList;
        
                }
            } catch (error) {
                console.error("Error during scrape process:", error);
                throw error; // Ensure the error propagates
            } finally {
                // Ensure browser closes in all cases
                await browser.close();
            }
        
            function calculateLevel(constantValue) {
                let lvl;
                const numberValue = parseFloat(constantValue);
                if (numberValue >= 14.0 && numberValue <= 14.5) {
                  lvl = 21;
                } else if (numberValue >= 14.6 && numberValue <= 14.9) {
                  lvl = 22;
                } else if (numberValue == 15.0) {
                  lvl = 23;
                } else {
                  // Handle other cases or return a default value
                  lvl = 0; // Or any other appropriate value
                }
                return lvl;
              }
        }
    }
}

