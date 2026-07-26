#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUTPUT_DIR = path.join(__dirname, '../public/maimai-images');
const DATA_FILE = path.join(__dirname, '../sega-maimai-map.json');
const SEGA_JSON_URL = 'https://maimai.sega.jp/data/maimai_songs.json';
const SEGA_IMG_BASE = 'https://maimaidx.jp/maimai-mobile/img/Music/';

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(() => resolve()));
        fileStream.on('error', reject);
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('Fetching SEGA maimai songs JSON...');
    const songs = await fetchJSON(SEGA_JSON_URL);
    console.log(`Got ${songs.length} songs`);

    const titleMap = {};
    let downloaded = 0;
    let skipped = 0;

    for (const song of songs) {
      const { title, image_url } = song;
      if (!image_url) {
        console.log(`Skipping "${title}" (no image_url)`);
        skipped++;
        continue;
      }

      const imgUrl = SEGA_IMG_BASE + image_url;
      const filePath = path.join(OUTPUT_DIR, image_url);
      const localUrl = `/maimai-images/${image_url}`;

      // Store mapping
      titleMap[title] = localUrl;

      // Skip if already exists
      if (fs.existsSync(filePath)) {
        console.log(`Already exists: ${title}`);
        skipped++;
        continue;
      }

      try {
        console.log(`Downloading: ${title} → ${image_url}`);
        await downloadImage(imgUrl, filePath);
        downloaded++;
      } catch (err) {
        console.error(`Failed to download ${image_url}: ${err.message}`);
      }
    }

    // Write mapping file
    fs.writeFileSync(DATA_FILE, JSON.stringify(titleMap, null, 2));
    console.log(`\n✓ Downloaded ${downloaded} images, ${skipped} skipped`);
    console.log(`✓ Mapping file saved: ${DATA_FILE}`);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
