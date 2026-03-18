Goal:

- Letterboxd watchlist additions -> Seerr request
- Letterboxd watched/logged films -> Radarr delete first, then Seerr request delete

Rules:

- Use `deleteFiles=true`
- Use `addImportExclusion=false`
- Never delete unless `/mnt/media/.MOUNT_OK` exists
- Preserve existing Letterboxd scraping, scheduling, and state logic where possible
- Do not add qBittorrent API logic
- Prefer minimal changes

Current stack assumptions:

- JellyBridge is retired and is not part of the active request flow
- Active pipeline is: Seerr -> Radarr/Sonarr -> qBittorrent via Gluetun -> hardlink into library -> Jellyfin
- qBittorrent is reached through Gluetun, not as a normal standalone container endpoint
- The stack depends on shared `/mnt/media:/media` mounts and hardlinks
- Current seeding behavior is intentional: ratio 1.5, Remove Completed enabled
- Mount safety matters because an unmounted `/mnt/media` can cause shadow writes to the boot SSD

Implementation intent:

- Reuse existing Letterboxd scraping/state code where possible
- Replace watchlist add-to-Radarr behavior with add-to-Seerr behavior
- Keep destructive authority in Radarr
- Use Seerr deletion only as post-delete cleanup after Radarr succeeds