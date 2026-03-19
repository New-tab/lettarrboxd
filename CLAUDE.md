# CLAUDE.md

## Project Overview

Lettarrboxd monitors one or more Letterboxd sources on a schedule and syncs them into a Seerr-centered movie workflow. Each URL operates in one of two modes:

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (diary URL only): deletes movies from Radarr via Seerr, then removes the Seerr media record. Use `/diary/` — not `/films/`. Delete mode uses the Letterboxd RSS feed; `/films/` is not supported.

## Commands

- `yarn start` - Run the compiled application
- `yarn start:dev` - Run with `nodemon`
- `yarn build` - Compile TypeScript
- `yarn test:unit` - Run unit tests
- `yarn test` - Run all tests

## Environment Variables

**Exactly one required:**
- `LETTERBOXD_URL` — single URL (backward compat)
- `LETTERBOXD_URLS` — comma-separated list of URLs

**Always required:**
- `SEERR_API_URL`, `SEERR_API_KEY`

**Optional:**
- `PORT` — default `3000`; status/control server port
- `DATA_DIR` — default `/data`
- `CHECK_INTERVAL_MINUTES` — default `10`, minimum `10`
- `DRY_RUN` — default `false`; skips all mutations (except delete-mode first-run bootstrap)
- `MEDIA_MOUNT_SENTINEL` — default `/mnt/media/.MOUNT_OK`; gates destructive deletes
- `FLARESOLVERR_URL`, `BYPARR_URL` — Cloudflare fallback for request-mode scraping
- `LETTERBOXD_TAKE_AMOUNT` + `LETTERBOXD_TAKE_STRATEGY` — must be set together; limits request-mode sources

## Architecture

- **`src/index.ts`** — `runAllSources()` loops over all URLs sequentially per tick, loads state once, saves once at the end. First-run delete bootstrap saves immediately.
- **`src/server.ts`** — Express server: `GET /status` (item counts, mode, etag per source), `POST /sync` (202 or 409 if already running).
- **`src/scraper/`** — RSS scraper for delete-mode URLs; HTML/AJAX scrapers for request-mode.
- **`src/util/state.ts`** — V2 format: `{ version: 2, sources: Record<url, SourceState> }`. V1 state auto-migrates on first load using the first configured URL as the source key.

## Behavior Notes

- **First delete-mode run** bootstraps all current items as `acknowledged` without deleting anything.
- **cleanupPending**: if `deleteMediaFile` succeeds but `deleteMedia` fails, item becomes `cleanupPending` with `seerrMediaId` stored. Retried next run without mount sentinel check.
- **TMDb-missing items** retry up to 3 times then become `skipped`.
- **Transient API failures** stay retryable and don't increment the retry counter.
- **Mode mismatch** on a URL resets that source's state and re-bootstraps.
- **Removed URLs** leave their `SourceState` in the file but are never processed.
