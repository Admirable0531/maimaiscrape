# Self-contained image — this bot talks to the maimaiscrape Express API over
# HTTP (MAIMAI_API_URL), not via direct requires, so unlike Discord_Bot's
# Dockerfile it doesn't need the rest of the monorepo copied in; the build
# context is this directory alone (see docker-compose.yml).
FROM node:22-bullseye

# better-sqlite3 is a native module — it ships prebuilt binaries for common
# platforms, but python3/make/g++ are the fallback if no prebuild matches
# this image's Node/arch combo (e.g. a Pi's arm64), so the install doesn't
# just fail there.
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  --no-install-recommends && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

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

# read_webpage's Playwright fallback (ENABLE_PLAYWRIGHT_FALLBACK) needs a
# Chromium binary this image doesn't ship by default — the .env.example
# already recommends leaving that flag off on a Pi 4 (a resident Chromium
# process is 200MB+ of RAM), so this image stays lean by default. To enable
# it anyway: uncomment the two lines below (adds Chromium + its system deps,
# a few hundred MB) and rebuild.
# RUN npx playwright install --with-deps chromium

# The official Node image's non-root "node" user is what lets Playwright's
# Chromium sandbox actually work if you do enable the fallback above — the
# sandbox is deliberately left on in playwrightFetcher.js (not disabled via
# --no-sandbox), and Chromium refuses to sandbox when running as root.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "src/index.js"]
