const { SlashCommandBuilder } = require('discord.js');
const XLSX = require('xlsx');
const path = require('path');
const { EmbedBuilder  } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
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
        const channel = interaction.channel;
        await interaction.deferReply();
        const constantValue = interaction.options.getString('constant');
        if (!isNaN(constantValue) && constantValue >= 14.0 && constantValue <= 15.0) {
        } else {
            // The constantValue is invalid
            await interaction.editReply({ content: 'Please provide a valid constant value (14.0 to 15.0) without whole numbers (14 or 15).', ephemeral: true });
            return;
        }
        const xlsxFilePath = './contents/prismConstant.xlsx';
        const songs = await scrape(findSongsByConstant(constantValue));
        await songs.sort((a, b) => {
            const scoreA = a[2] ? parseFloat(a[2]) : -Infinity; // Treat undefined as the lowest
            const scoreB = b[2] ? parseFloat(b[2]) : -Infinity; // Treat undefined as the lowest
        
            return scoreB - scoreA; // Sort in descending order
        });
        function capitalizeFirstLetter(string) {
            return string.charAt(0).toUpperCase() + string.slice(1);
        }
        const guy = interaction.options.getString('guy');
        if(guy){
            man = capitalizeFirstLetter(guy);
        } else {
            man = "Azu";
        }
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

        function findSongsByConstant(value) {
            // Read the .xlsx file
            const workbook = XLSX.readFile(xlsxFilePath);
            const sheetName = '14以上'; // Set the correct sheet name
            const sheet = workbook.Sheets[sheetName];
        
            const songs = []; // Array to hold all matching songs
        
            // Columns for "新定数" (hardcoded)
            const constantColumns = [4, 11, 18, 25, 32]; // Columns E, L, S, Z, AG
        
            // Convert the sheet to raw data format
            const range = XLSX.utils.decode_range(sheet['!ref']); // Get the range of the sheet
        
            // Loop through each row in the range
            for (let row = range.s.r; row <= range.e.r; row++) {
                for (let col of constantColumns) {
                    let constantCell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
                    if (constantCell && constantCell.v == value) {
                        // Assuming the song name is 5 columns to the left of the found constant
                        let songCell = sheet[XLSX.utils.encode_cell({ r: row, c: col - 4 })];
                        if (songCell) {
                            let songDiffCell = sheet[XLSX.utils.encode_cell({ r: row, c: col - 1 })];
                            songs.push([songCell.v, songDiffCell.v]);
                        }
                    }
                }
            }
        
            return songs.length > 0 ? songs : null; // Return all matching songs, or null if none are found
        }

        async function scrape(songs){
            const guy = interaction.options.getString('guy');
            const browser = await puppeteer.launch({
                executablePath: '/usr/bin/chromium-browser', // Adjust this path if necessary
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
              });
            const page = await browser.newPage();
            await page.goto('https://maimaidx-eng.com');
            await page.click('.c-button--openid--segaId');

            try {
                // Wait for the SID input to be clickable and then enter the username
                await page.waitForSelector('#sid', { visible: true, timeout: 10000 });
                await page.type('#sid', user); // Replace with your login_user variable
        
                // Wait for the password input to be clickable and then enter the password
                await page.waitForSelector('#password', { visible: true, timeout: 10000 });
                await page.type('#password', pass); // Replace with your login_pass variable
        
            } catch (error) {
                console.error("Input element not found:", error);
            }
        
            // Wait for the login button to be clickable and then click it
            await page.waitForSelector('.c-button--login', { visible: true, timeout: 10000 });
            await page.click('.c-button--login');
        
            // Optionally, you can wait for some element that appears after logging in

            await page.waitForSelector('.comment_block', { visible: true });
            const idxMap = {
                klcc: '4039890368767',
                yuchen: '6020500221031',
                marcus: '8071982688053',
                kok: '8085423055111',
                yuan: '8070962675681',
                keyang: '8091021494559',
                jerry: '6028368715803'
            };
            
            if(guy in idxMap){
                const idx = idxMap[guy];
                await page.goto(`https://maimaidx-eng.com/maimai-mobile/friend/friendLevelVs/battleStart/?scoreType=2&level=${calculateLevel(constantValue)}&idx=${idx}`);

                await page.waitForSelector('.footer_banner', { visible: true });
                for (const [musicName, difficulty] of songs) {
                    // Determine the correct selector based on difficulty
                    const blockSelector = difficulty === 'ReMAS' 
                        ? '.music_remaster_score_back' 
                        : difficulty === 'MAS' 
                        ? '.music_master_score_back' 
                        : null;
                
                        const musicBlocks = await page.$$eval(blockSelector, (blocks, difficulty) => {
                            return blocks.map(block => {
                                const name = block.querySelector('.music_name_block.t_l.f_13.break')?.textContent.trim();
                                
                                // Determine the correct score label class based on difficulty
                                const scoreLabelClass = difficulty === 'ReMAS' ? '.remaster_score_label' : '.master_score_label';
                
                                // Get all score labels
                                const scoreLabels = block.querySelectorAll(scoreLabelClass);
                                const scores = Array.from(scoreLabels).map(label => label.textContent.trim());
                
                                // Assuming you want the second score
                                const score = scores[1] || null; // Use the second score if it exists
                
                                return { name, score };
                            });
                        }, difficulty); // Pass difficulty as an argument
                
                        // Check if the music name exists in the page blocks
                        const found = musicBlocks.find(music => music.name === musicName);
                        if (found) {
                            // Add the score to the corresponding song entry
                            const index = songs.findIndex(song => song[0] === musicName);
                            if (index !== -1) {
                                songs[index][2] = found.score; // Update with score
                            }
                        }
                    }
                    await browser.close();
                    return songs;
            } else {
                
                await page.goto(`https://maimaidx-eng.com/maimai-mobile/record/musicLevel/search/?level=${calculateLevel(constantValue)}`);
                
                await page.waitForSelector('.footer_banner', { visible: true });
                for (const [musicName, difficulty] of songs) {
                    // Determine the correct selector based on difficulty
                    const blockSelector = difficulty === 'ReMAS' 
                        ? '.music_remaster_score_back' 
                        : difficulty === 'MAS' 
                        ? '.music_master_score_back' 
                        : null;
                
                    if (blockSelector) {
                        // Get all music blocks of the appropriate type
                        const musicBlocks = await page.$$eval(blockSelector, blocks => {
                            return blocks.map(block => {
                                const name = block.querySelector('.music_name_block.t_l.f_13.break')?.textContent.trim();
                                const score = block.querySelector('.music_score_block.w_112.t_r.f_l.f_12')?.textContent.trim();
                                return { name, score };
                            });
                        });
                
                        // Check if the music name exists in the page blocks
                        const found = musicBlocks.find(music => music.name === musicName);
                        if (found) {
                            // Add the score to the corresponding song entry
                            const index = songs.findIndex(song => song[0] === musicName);
                            if (index !== -1) {
                                songs[index][2] = found.score; // Update with score
                            }
                        }
                    }
                }
                await browser.close();
                return songs;
            }



            function calculateLevel(constantValue) {
                let lvl;
                const numberValue = parseFloat(constantValue);
                if (numberValue >= 14.0 && numberValue <= 14.5) {
                  lvl = 21;
                } else if (numberValue >= 14.6 && numberValue <= 14.9) {
                  lvl = 22;
                } else if (numberValue === 15.0) {
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

