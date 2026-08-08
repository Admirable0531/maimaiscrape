# Deploying to a Raspberry Pi

The app runs as four always-on containers (`bot`, `api`, `mongodb`, `web`) plus
one manual-only container (`scraper`), orchestrated by `docker-compose.yml` at
the repo root. See `README.md` for what each service does and `DOCKER_COMMANDS.md`
for day-to-day operational commands once it's running.

## 1. Prerequisites

- A Raspberry Pi (or any Linux ARM64/AMD64 host) with Docker and the Docker
  Compose plugin installed (`docker --version`, `docker compose version`).
- A Discord bot token/client ID and maimai DX NET credentials (see `.env.example`).

SSH in for everything below.

## 2. Get the code onto the host

```bash
git clone https://github.com/admirable0531/maimaiscrape.git
cd maimaiscrape
```

## 3. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in real values for `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `MAIMAI_USER`,
`MAIMAI_PASS`, `MAIMAI_ACCOUNT_RATING_FY`, `MAIMAI_PASSWORD_RATING`,
`FRIEND_WEBHOOK_URL_FY`, `CIRCLE_WEBHOOK_URL` — see README's Configuration
section for the full list. Never commit `.env`.

## 4. Build and start the containers

```bash
docker compose up -d --build
docker compose ps
```

## 5. Register Discord slash commands

```bash
docker compose exec bot node discord-bot/deploy-commands.js
```

Re-run this only when the set of slash commands changes.

## 6. Verify

```bash
docker compose logs -f --tail=50 bot
```

Confirm the bot logs in and the next scheduled run (`DAILY_PIPELINE_AT` /
`CIRCLE_RUN_AT`, see README) fires without errors, or trigger `/daily` in
Discord to check immediately.

## Updating after a code change

```bash
cd maimaiscrape
git pull
docker compose down
docker compose up -d --build
```

This is exactly what the auto-deploy workflow below does, if you'd rather not
do it by hand.

## Auto-deploy on push (self-hosted GitHub Actions runner)

`.github/workflows/deploy.yml` runs `git pull && docker compose down && docker
compose up -d --build` on every push to `main`. It runs on a self-hosted
runner registered directly on the Pi rather than GitHub's cloud SSHing in —
the runner polls outward to GitHub, so nothing on the Pi needs to be
reachable from the internet (no port forward, no DDNS, no SSH secrets to
keep in sync).

To register the runner (one-time — GitHub runners are scoped to a single
repository, so a separate repo like `discord-ai-maimai-assistant` needs its
own runner instance):

1. On GitHub: repo → **Settings → Actions → Runners → New self-hosted
   runner**, choose Linux/ARM64. Copy the `--token` value it shows you (valid
   for about an hour).
2. On the Pi:
   ```bash
   mkdir -p ~/actions-runner-<name> && cd ~/actions-runner-<name>
   curl -o actions-runner.tar.gz -L <download URL from the same GitHub page>
   tar xzf actions-runner.tar.gz
   ./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> --name <runner-name> --work _work --unattended
   ```
3. Install it as a persistent systemd service so it survives reboots (needs
   `sudo`, run interactively — not something to script over a non-interactive
   SSH session):
   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

Without step 3, the runner can still run in the foreground (or via `nohup
./run.sh &` for a quick, non-persistent start), but it won't come back after
a reboot.

Check what's currently registered:

```bash
systemctl list-units --type=service | grep actions
```
