const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('maipage')
		.setDescription('Get your maimai page'),
	async execute(interaction) {
        interaction.deferReply();
        async function getPage() {
            dotenv.config(); // Load variables from .env file

            // Access variables
            const clal = process.env.CLAL;
            const url1 = "https://lng-tgk-aime-gw.am-all.net/common_auth/";
            const url2 = "https://maimaidx-eng.com/";

            const cookies = [{
                'name': 'clal',
                'value': clal
              }]
            const browser = await puppeteer.launch({ headless: false });
            const page = await browser.newPage();
            await page.goto(url1);
            await page.setCookie(...cookies);
            const page2 = await browser.newPage();
            await page2.goto(url2);
            
            await page2.waitForSelector('.name_block', { timeout: 5000 });

            const textContent1 = await page2.$eval('.name_block', element => element.innerText);


            await page2.waitForSelector('.rating_block', { timeout: 5000 });

            const textContent2 = await page2.$eval('.rating_block', element => element.innerText);

            interaction.editReply(textContent1 + " " + textContent2);
            await browser.close();

        }   
        getPage();
    }
}