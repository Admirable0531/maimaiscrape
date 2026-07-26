# Shared image for the Discord bot and the express api.
# Both need Node + Chromium (Puppeteer) + the bot scripts + server/.
FROM node:18-bullseye

# Chromium and its runtime libraries
RUN apt-get update && apt-get install -y \
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

# Use the system Chromium and skip Puppeteer's own download: the bundled build is
# x86-only, so on ARM (Raspberry Pi) it is both a large wasted download and unusable.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Keep the repository layout inside the image, so relative requires such as
# server/ -> ../Discord_Bot/config resolve identically in Docker and locally.
# (Previously Discord_Bot/* was flattened into /app, which broke
# server/express_server.js's require of ../Discord_Bot/scripts/friends_webhook.)
COPY Discord_Bot/ ./Discord_Bot/
COPY server/ ./server/

CMD ["node", "Discord_Bot/index.js"]
