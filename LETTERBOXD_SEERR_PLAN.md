Goal:
- Watchlist additions -> Seerr request
- Watched/diary films -> Radarr delete first, then Seerr request delete

Rules:
- Use deleteFiles=true
- Use addImportExclusion=false
- Never delete unless /mnt/media/.MOUNT_OK exists
- Preserve existing Letterboxd scraping/state logic
- Do not add qBittorrent API logic
- Prefer minimal changes
