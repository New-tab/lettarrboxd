# Lettarrboxd

Sync a single Letterboxd source into a Seerr-centered movie workflow.

## Overview

The runtime has two modes, determined by `LETTERBOXD_URL`:

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (diary URL): when a film appears in your diary, deletes it from Radarr via Seerr, then removes the Seerr media record.

> **Why diary and not `/films/`?**
> Letterboxd's `/films/` page shows your full watch history, but it's Cloudflare-protected and requires a headless browser (FlareSolverr) to scrape — too resource-intensive for frequent polling. Delete mode uses Letterboxd's RSS feed instead, which is lightweight, supports ETag caching (skips unchanged feeds entirely), and is perfectly suited to diary entries. If you log your watches to your diary, use `https://letterboxd.com/username/diary/` as your `LETTERBOXD_URL`.

## Confirmed Runtime Behavior

- Watchlists create Seerr requests; no direct Radarr interaction.
- Diary entries run in delete mode: `DELETE /media/{id}/file` (removes from Radarr), then `DELETE /media/{id}` (removes Seerr record).
- Delete mode first run bootstraps all existing diary entries as acknowledged without deleting anything.
- Destructive deletes are blocked unless the mount sentinel exists at `MEDIA_MOUNT_SENTINEL` (default `/mnt/media/.MOUNT_OK`).
- State is persisted in `DATA_DIR/sync-state.json`.
- Run one container per Letterboxd source, each with its own `DATA_DIR`.
- `DRY_RUN=true` performs no API mutations and does not persist state.

## Documented v1 Sources

| URL pattern | Mode |
|-------------|------|
| `https://letterboxd.com/username/watchlist/` | Request |
| `https://letterboxd.com/username/diary/` | Delete (recommended) |
| `https://letterboxd.com/username/list/list-name/` | Request |

Additional recognized URL types (outside the primary v1 workflow):

- Collections: `https://letterboxd.com/films/in/collection-name/`
- Popular movies: `https://letterboxd.com/films/popular/`
- Actor filmography: `https://letterboxd.com/actor/actor-name/`
- Director filmography: `https://letterboxd.com/director/director-name/`
- Writer filmography: `https://letterboxd.com/writer/writer-name/`

## Environment

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `LETTERBOXD_URL` | Letterboxd source URL | `https://letterboxd.com/username/diary/` |
| `SEERR_API_URL` | Seerr base URL | `http://seerr:5055` |
| `SEERR_API_KEY` | Seerr API key (must have ADMIN + MANAGE_REQUESTS) | `your_seerr_api_key` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECK_INTERVAL_MINUTES` | `10` | Poll interval in minutes (minimum 1) |
| `DATA_DIR` | `/data` | Directory for `sync-state.json` |
| `MEDIA_MOUNT_SENTINEL` | `/mnt/media/.MOUNT_OK` | Path that must exist before delete-mode mutations run |
| `DRY_RUN` | `false` | Log intended actions without mutating services or state |
| `FLARESOLVERR_URL` | - | FlareSolverr endpoint; used as Cloudflare fallback for request-mode scraping |
| `BYPARR_URL` | - | Byparr endpoint; used as secondary Cloudflare fallback after FlareSolverr |
| `LETTERBOXD_TAKE_AMOUNT` | - | Limit movies processed per run; must be set with `LETTERBOXD_TAKE_STRATEGY` |
| `LETTERBOXD_TAKE_STRATEGY` | - | `newest` or `oldest`; must be set with `LETTERBOXD_TAKE_AMOUNT` |

## Docker

### Watchlist request-mode instance

```bash
docker run -d \
  --name seerrboxd-watchlist \
  -e LETTERBOXD_URL=https://letterboxd.com/username/watchlist/ \
  -e SEERR_API_URL=http://seerr:5055 \
  -e SEERR_API_KEY=your_seerr_api_key \
  -e CHECK_INTERVAL_MINUTES=60 \
  -v ./data/watchlist:/data \
  ghcr.io/New-tab/seerrboxd:latest
```

### Diary delete-mode instance

```bash
docker run -d \
  --name seerrboxd-diary \
  -e LETTERBOXD_URL=https://letterboxd.com/username/diary/ \
  -e SEERR_API_URL=http://seerr:5055 \
  -e SEERR_API_KEY=your_seerr_api_key \
  -e MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK \
  -e CHECK_INTERVAL_MINUTES=5 \
  -v ./data/diary:/data \
  ghcr.io/New-tab/seerrboxd:latest
```

### Docker Compose (both modes)

```yaml
services:
  seerrboxd-watchlist:
    image: ghcr.io/New-tab/seerrboxd:latest
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/username/watchlist/
      - SEERR_API_URL=http://seerr:5055
      - SEERR_API_KEY=your_seerr_api_key
      - CHECK_INTERVAL_MINUTES=60
    volumes:
      - ./data/watchlist:/data

  seerrboxd-diary:
    image: ghcr.io/New-tab/seerrboxd:latest
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/username/diary/
      - SEERR_API_URL=http://seerr:5055
      - SEERR_API_KEY=your_seerr_api_key
      - MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK
      - CHECK_INTERVAL_MINUTES=5
    volumes:
      - ./data/diary:/data
```

## Development

```bash
yarn install
yarn start:dev
yarn test:unit
yarn build
```

## Troubleshooting

### Watchlist mode is not creating Seerr requests

- Verify `SEERR_API_URL` and `SEERR_API_KEY`.
- Confirm the Letterboxd source URL is public.
- Try `DRY_RUN=true` to inspect intended behavior without mutating anything.
- If you see 403 errors, set `FLARESOLVERR_URL` and/or `BYPARR_URL`.

### Delete mode is not removing movies

- Confirm the mount sentinel exists: `ls /mnt/media/.MOUNT_OK` (or your custom `MEDIA_MOUNT_SENTINEL`).
- Remember that the first delete-mode run bootstraps state and does not delete anything — deletions begin on the second run.
- Verify your Seerr API key has both ADMIN and MANAGE_REQUESTS permissions.
- Use `DRY_RUN=true` to confirm the app sees the right items before enabling live deletes.

### Films are not being picked up for deletion

- Make sure you are using your **diary** URL (`/diary/`), not your films URL (`/films/`). Delete mode uses Letterboxd's RSS feed, which only includes diary-logged entries.
- Confirm the film was logged to your diary with a date on Letterboxd (not just marked as watched).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

## Legal Disclaimer

This project is intended for use with legally sourced media only. Users are responsible for ensuring their use complies with applicable laws and regulations.
