# All Video Downloader - Low to 1080p Free

Private cloud downloader: Node/Express + yt-dlp + ffmpeg. Open it from your phone; your PC can stay off.

## Files
`server.js`, `package.json`, `Dockerfile`, `public/index.html`, `public/style.css`, `public/app.js`

## Deploy on Render (easiest)
1. Push this folder to a private GitHub repo.
2. Render > New > Web Service > connect the repo. Runtime: **Docker** (it finds the Dockerfile).
3. Environment variables: `ACCESS_PIN` = your secret PIN (required in practice).
4. Deploy. Open the `.onrender.com` URL on your phone and use "Add to Home Screen".
Note: the free plan sleeps after idle time, so the first load can take about 30 seconds.

## Deploy on Railway
New Project > Deploy from GitHub repo. It detects the Dockerfile. Add `ACCESS_PIN` under Variables, then Settings > Networking > Generate Domain.

## Deploy on a Linux VPS
```
git clone <your-repo> avd && cd avd
docker build -t avd .
docker run -d --restart=always -p 80:3000 -e ACCESS_PIN=yourpin --name avd avd
```
Put it behind HTTPS (Caddy or Cloudflare) so the PIN is not sent in plain text.

## Keep yt-dlp updated (important)
Sites change often. The server runs `yt-dlp -U` at start and every 12 hours. If downloads suddenly fail, redeploy or restart the service, which rebuilds with the newest yt-dlp. On a VPS: `docker exec avd yt-dlp -U`.

## Known limits
- **YouTube may block cloud IPs** ("Sign in to confirm you are not a bot"). Fix: export your cookies from a browser to `cookies.txt`, add it as a secret file, and set `COOKIES_FILE=/path/cookies.txt`. A VPS with a residential-friendly provider also helps.
- Files are deleted from the server after about 20 minutes. One download at a time per job, max 2 jobs at once (`MAX_JOBS`).
- 1080p merging needs CPU and disk; very small free instances may be slow for long videos.
- Download only content you own or have permission to save. Platform terms may restrict downloading.
