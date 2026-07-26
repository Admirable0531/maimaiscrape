# Running commands inside Docker (e.g. from SSH on Raspberry Pi)

From the project directory on the Pi (`~/Desktop/maimaiscrape` or wherever the repo is):

---

## Watch the browser (visible mode) or save screenshots

**Option 1: Screenshots (works over plain SSH)**  
Saves PNGs at key steps so you can inspect after the run or `scp` them to your laptop.

```bash
# With Docker: mount a folder so you can copy screenshots out
docker compose run --rm \
  -e SCREENSHOT_DEBUG=1 \
  -v "$(pwd)/screenshots:/app/screenshots" \
  scraper node server/update_user_data.js
```

Then open `./screenshots/` (e.g. `01_home_*.png`, `04_friend_list_*.png`, `05_friend_6020500221031_*.png`).

**Option 2: Visible browser on the Pi (monitor attached)**  
Run the scraper **on the host** (not in Docker) so Chromium uses the Pi’s display. On ARM you must have system Chromium installed (same as the Docker image):

```bash
sudo apt update && sudo apt install chromium
cd ~/Desktop/maimaiscrape
HEADLESS=false DISPLAY=:0 MONGO_URI=mongodb://localhost:27017/ node server/update_user_data.js
```

**Option 3: Visible browser over SSH (window on your laptop)**  
From your **laptop** connect with X11 forwarding, then run the scraper (on the Pi, not in Docker):

```bash
# On your laptop
ssh -X pi@<pi-ip>
cd ~/Desktop/maimaiscrape
HEADLESS=false npm run scraper
# MONGO_URI=mongodb://localhost:27017/ if needed
```

The browser window will open on your laptop. Requires an X server on the laptop (e.g. XQuartz on macOS, VcXsrv/Xming on Windows, or native X on Linux).

**Why Docker works but host failed:** The scraper image installs Chromium via `apt install chromium` and sets `PUPPETEER_EXECUTABLE_PATH`. On the Pi without Docker, no system Chromium was found, so Puppeteer used its bundled browser—which is x86 only. Installing Chromium on the host (`sudo apt install chromium`) makes non-Docker runs use the same approach as the container.

---

## Run scraper once (manual run)

Uses the `scraper` image; connects to MongoDB as `mongodb:27017` inside the network.

```bash
docker compose run --rm scraper node server/update_user_data.js
```

`--rm` removes the container after it exits.

## Run migration (old name collections → friendIdx)

Uses the `api` service (has Node + server code and can reach MongoDB). Run this once to copy old `yuchen_top` etc. into `friend_6020500221031_top` and update `user_info`.

```bash
docker compose run --rm api node server/scripts/migrate-collections-to-friend-idx.js
```

If the API container is already running you can use:

```bash
docker compose exec api node server/scripts/migrate-collections-to-friend-idx.js
```

## Open a shell in a container

```bash
# Scraper container (Puppeteer / Chromium)
docker compose exec scraper sh

# API container
docker compose exec api sh

# Bot container
docker compose exec bot sh
```

Then run commands inside that container (e.g. `node server/update_user_data.js` from `/app` in the scraper).

## One-liner reference

| What              | Command |
|-------------------|--------|
| Manual scraper run | `docker compose run --rm scraper node server/update_user_data.js` |
| Migration         | `docker compose run --rm api node server/scripts/migrate-collections-to-friend-idx.js` |
| Shell in scraper  | `docker compose exec scraper sh` |
