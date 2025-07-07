# 🎵 Maimai Top Play Scalp

A Python-based system that scrapes top play and profile information from the **maimai DX website** (for you and your friends) and sends it to a Discord channel daily.

## 📦 Features

- Scrapes logged-in user profile and top plays
- Injects `mai-tools` analysis scripts for better data
- Scrapes data from friends’ profiles too
- Sends all results to a specified Discord channel
- Runs daily via scheduler
- Uses Firefox (Selenium) in a Docker container

## 🛠️ Setup

### 1. Clone the repo

```bash
git clone https://github.com/admirable0531/maimaiscrape.git
cd maimaiscrape
```

### 2. Edit the .env file

### 3. Build and run with Docker Compose

```bash
docker compose build
docker compose up -d
```
