const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('plates')
		.setDescription('Gets your plate progress'),
	async execute(interaction) {
        async function getPlate(ver, kind) {
            dotenv.config(); // Load variables from .env file

            // Access variables
            const login_user = process.env.MAIMAI_USER;
            const login_pass = process.env.MAIMAI_PASS;
            const url = "https://maimaidx-eng.com";

            const browser = await puppeteer.launch({ headless: false });
            const page = await browser.newPage();
            let v;
            switch(ver) {
                case "maimai":
                    v = "V-0";
                    break;
                case "maimai+":
                    v = "V-1";
                    break;
                case "green":
                    v = "V-2";
                    break;
                case "green+":
                    v = "V-3";
                    break;
                case "orange":
                    v = "V-4";
                    break;
                case "orange+":
                    v = "V-5";
                    break;
                case "pink":
                    v = "V-6";
                    break;
                case "pink+":
                    v = "V-7";
                    break;
                case "murasaki":
                    v = "V-8";
                    break;
                case "murasaki+":
                    v = "V-9";
                    break;
                case "milk":
                    v = "V-10";
                    break;
                case "milk+":
                    v = "V-11";
                    break;
                case "finale":
                    v = "V-12";
                    break;
                case "deluxe":
                    v = "V-13";
                    break;
                case "deluxe+":
                    v = "V-14";
                    break;
                case "splash":
                    v = "V-15";
                    break;
                case "splash+":
                    v = "V-16";
                    break;
                case "universe":
                    v = "V-17";
                    break;
                case "universe+":
                    v = "V-18";
                    break;
                case "festival":
                    v = "V-19";
                    break;
                case "festival+":
                    v = "V-20";
                    break;
                case "buddies":
                    v = "V-21";
                    break;
                default:
                    break;
            }
            await page.goto(url);
            await page.click('.c-button--openid--segaId');

            // Fill in the login credentials
            await page.waitForSelector('#sid');
            await page.type('#sid', login_user);
            await page.waitForSelector('#password');
            await page.type('#password', login_pass);
        
            // Click the login button
            await page.click('.c-button--login');
            // Wait for page to load after login
            await page.waitForNavigation();
            const plateURL = "https://maimaidx-eng.com/maimai-mobile/record/musicSort/search/?search=";
            const diff = 3;
            await page.goto(plateURL + v + "&sort=1&diff=" + diff);
            
            const html = await page.evaluate(() => {
                const blocks = Array.from(document.querySelectorAll('.music_master_score_back'));
                return blocks.map(block => block.outerHTML);
              });
            const sanitizedHTMLStrings = html.map(html => {
                return html.replace(/\n|\t/g, '');
            });
            
            console.log(sanitizedHTMLStrings);

            const extractedInfo = sanitizedHTMLStrings.map(html => {
                // Extract song name
                const name = html.match(/<div class="music_name_block[^>]*>(.*?)<\/div>/)[1];
            
                // Extract song level
                const levelMatch = html.match(/<div class="music_lv_block[^>]*>(.*?)<\/div>/);
                const level = levelMatch ? levelMatch[1] : '';
            
                // Extract completion percentage
                const percentageMatch = html.match(/(\d+\.\d+)%/);
                const percentage = percentageMatch ? percentageMatch[1] : '0';
            
                const excludedImageSources = [
                    'https://maimaidx-eng.com/maimai-mobile/img/diff_master.png',
                    'https://maimaidx-eng.com/maimai-mobile/img/music_standard.png',
                    'https://maimaidx-eng.com/maimai-mobile/img/music_dx.png',
                    'https://maimaidx-eng.com/maimai-mobile/img/music_icon_back.png?ver=1.35',
                    'https://maimaidx-eng.com/maimai-mobile/img/deluxscore.png'
                ];

                // Extract image sources
                const imgMatches = html.match(/<img src="(.*?)"/g);
                const imgSources = imgMatches ? imgMatches.map(match => match.match(/<img src="(.*?)"/)[1]).filter(src => !excludedImageSources.includes(src)) : [];
                if (parseFloat(percentage) < 100) {

                }
                return {
                    name,
                    level,
                    percentage,
                    imgSources
                };
            });
            
            console.log(extractedInfo);

            // const newEmbed = new EmbedBuilder()
            //     .setColor(0x7289da)
            // musicNames.forEach(name => {
            //     newEmbed.addFields({name: ' ', value: name});
            // });
            // interaction.reply({ embeds: [newEmbed] });
            //   await browser.close();
          }

          getPlate("festival+", "sss");
    }
}