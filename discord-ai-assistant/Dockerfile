# Self-contained image — this bot talks to the maimaiscrape Express API over
# HTTP (MAIMAI_API_URL), not via direct requires, so unlike Discord_Bot's
# Dockerfile it doesn't need the rest of the monorepo copied in; the build
# context is this directory alone (see docker-compose.yml).
FROM node:22-bullseye

# better-sqlite3 is a native module — it ships prebuilt binaries for common
# platforms, but python3/make/g++ are the fallback if no prebuild matches
# this image's Node/arch combo (e.g. a Pi's arm64), so the install doesn't
# just fail there. Chromium + its runtime libs are here too, for
# maimaiAccountSession.js (this tracked account's authenticated maimai DX
# NET browsing) — it unconditionally launches a real browser via Playwright,
# and Playwright's OWN downloaded build doesn't support arm64 Debian at all
# ("ERROR: Playwright does not support chromium on debian11-arm64" —
# confirmed live on the Pi), so this uses the same fix Discord_Bot/Dockerfile
# and server/update_user_data.js already use for the identical problem on
# this same hardware: apt's own Chromium build + an explicit executablePath
# in maimaiAccountSession.js, skipping Playwright's downloader entirely.
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libxss1 \
  xdg-utils \
  --no-install-recommends && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
# Playwright's postinstall normally tries to download its own browser build —
# skip it, since the system Chromium above is what actually gets used.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# package-lock.json is committed, so `npm ci` (exact, reproducible install)
# over `npm install`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# better-sqlite3 ships its linux-arm64 prebuild bundled directly in the npm
# package (not fetched at install time), and its own binding.js loads that
# file unconditionally whenever it exists — env vars like
# npm_config_build_from_source never come into play. That bundled prebuild
# is built against a newer glibc than bullseye ships (fails with
# "GLIBC_2.38 not found" at runtime on a Pi), so delete it and compile from
# source against the toolchain installed above instead.
RUN rm -f node_modules/better-sqlite3/prebuilds/linux-arm64.node && \
  (cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild --release)

COPY . .

# The official Node image's non-root "node" user is what lets Playwright's
# Chromium sandbox actually work — the sandbox is deliberately left on in
# both playwrightFetcher.js and maimaiAccountSession.js (not disabled via
# --no-sandbox), and Chromium refuses to sandbox when running as root.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "src/index.js"]
