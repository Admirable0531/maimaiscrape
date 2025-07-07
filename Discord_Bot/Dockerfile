FROM node:18-bullseye

# Install Chromium dependencies
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

# Puppeteer expects this environment variable if Chromium is not bundled
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "."]
