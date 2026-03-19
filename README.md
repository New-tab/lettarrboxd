# Seerrboxd

Monitor one or more Letterboxd sources on a schedule and sync them into a Seerr-centered movie workflow.

## Overview

Each configured URL operates in one of two modes:

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (diary URL only): when a film appears in your diary, deletes it from Radarr via Seerr, then removes the Seerr media record.

> **Why diary and not `/films/`?**
> Letterboxd's `/films/` page shows your full watch history, but it's Cloudflare-protected and requires a headless browser (FlareSolverr) to scrape — too resource-intensive for frequent polling. Delete mode uses Letterboxd's RSS feed instead, which is lightweight and perfectly suited to diary entries. If you log your watches to your diary, use `https://letterboxd.com/username/diary/` as your delete-mode URL.

Run a single container with multiple URLs — request mode and delete mode can coexist safely in one instance.

## Confirmed Runtime Behavior

- Watchlists create Seerr requests; no direct Radarr interaction.
- Diary entries run in delete mode: `DELETE /media/{id}/file` (removes from Radarr), then `DELETE /media/{id}` (removes Seerr record).
- Delete mode first run bootstraps all existing diary entries as acknowledged without deleting anything.
- Destructive deletes are blocked unless the mount sentinel exists at `MEDIA_MOUNT_SENTINEL` (default `/mnt/media/.MOUNT_OK`).
- State is persisted in `DATA_DIR/sync-state.json`.
- `DRY_RUN=true` skips all API mutations. On the first delete-mode run, bootstrap state is still saved so subsequent runs work correctly.

## Supported URL Types

| URL pattern | Mode |
|-------------|------|
| `https://letterboxd.com/username/watchlist/` | Request |
| `https://letterboxd.com/username/diary/` | Delete |
| `https://letterboxd.com/username/list/list-name/` | Request |
| `https://letterboxd.com/films/in/collection-name/` | Request |
| `https://letterboxd.com/films/popular/` | Request |
| `https://letterboxd.com/actor/actor-name/` | Request |
| `https://letterboxd.com/director/director-name/` | Request |
| `https://letterboxd.com/writer/writer-name/` | Request |

## Environment

### Required (exactly one)

| Variable | Description | Example |
|----------|-------------|---------|
| `LETTERBOXD_URLS` | Comma-separated list of Letterboxd source URLs | `https://letterboxd.com/username/watchlist/,https://letterboxd.com/username/diary/` |
| `LETTERBOXD_URL` | Single URL (backward-compatible) | `https://letterboxd.com/username/watchlist/` |

### Always required

| Variable | Description | Example |
|----------|-------------|---------|
| `SEERR_API_URL` | Seerr base URL | `http://seerr:5055` |
| `SEERR_API_KEY` | Seerr API key (must have ADMIN + MANAGE_REQUESTS) | `your_seerr_api_key` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Status/control server port |
| `CHECK_INTERVAL_MINUTES` | `10` | Poll interval in minutes (minimum 10) |
| `DATA_DIR` | `/data` | Directory for `sync-state.json` |
| `MEDIA_MOUNT_SENTINEL` | `/mnt/media/.MOUNT_OK` | Path that must exist before delete-mode mutations run |
| `DRY_RUN` | `false` | Log intended actions without mutating services or state |
| `FLARESOLVERR_URL` | - | FlareSolverr endpoint; used as Cloudflare fallback for request-mode scraping |
| `BYPARR_URL` | - | Byparr endpoint; used as secondary Cloudflare fallback after FlareSolverr |
| `LETTERBOXD_TAKE_AMOUNT` | - | Limit movies processed per run; must be set with `LETTERBOXD_TAKE_STRATEGY` |
| `LETTERBOXD_TAKE_STRATEGY` | - | `newest` or `oldest`; must be set with `LETTERBOXD_TAKE_AMOUNT` |

## Status & Control Server

Seerrboxd runs a small HTTP server on `PORT` (default 3000).

- `GET /status` — returns per-source item counts, mode, and etag
- `POST /sync` — triggers an immediate sync (returns 202, or 409 if already running)

## Docker

### Single container, multiple sources (recommended)

```bash
docker run -d \
  --name seerrboxd \
  -e LETTERBOXD_URLS=https://letterboxd.com/username/watchlist/,https://letterboxd.com/username/diary/ \
  -e SEERR_API_URL=http://seerr:5055 \
  -e SEERR_API_KEY=your_seerr_api_key \
  -e MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK \
  -e CHECK_INTERVAL_MINUTES=10 \
  -v ./data:/data \
  -v /mnt/media:/mnt/media:ro \
  cluelessidiot1/seerrboxd:latest
```

### Docker Compose

```yaml
services:
  seerrboxd:
    image: cluelessidiot1/seerrboxd:latest
    container_name: seerrboxd
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - LETTERBOXD_URLS=https://letterboxd.com/username/watchlist/,https://letterboxd.com/username/diary/
      - SEERR_API_URL=http://seerr:5055
      - SEERR_API_KEY=your_seerr_api_key
      - CHECK_INTERVAL_MINUTES=10
      - MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK
      - DATA_DIR=/data
    volumes:
      - ./data:/data
      - /mnt/media:/mnt/media:ro
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
