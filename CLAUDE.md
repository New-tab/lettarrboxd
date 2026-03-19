# CLAUDE.md

This file describes the current code shape in this repository. If docs disagree with the code, trust the code.

## Project Overview

Lettarrboxd monitors one or more Letterboxd sources on a schedule and syncs them into a Seerr-centered movie workflow. Multiple URLs run in a single container with unified V2 state.

Each URL operates in one of two modes:

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (diary URL): deletes movies from Radarr via Seerr, then removes the Seerr media record. Radarr is never contacted directly. Use `/diary/` — not `/films/`. Delete mode uses Letterboxd's RSS feed, which only contains diary-logged entries; `/films/` would require Cloudflare-bypassing HTML scraping and is not supported for delete mode.

Cross-mode conflict resolution is not needed: Letterboxd automatically removes movies from your watchlist when you log them in your diary, so each source can operate independently.

## Commands

- `yarn start` - Run the compiled application
- `yarn start:dev` - Run with `nodemon`
- `yarn build` - Compile TypeScript
- `yarn test:unit` - Run unit tests (excludes integration tests)
- `yarn test` - Run all tests

## Environment Variables

Validated with Zod in `src/util/env.ts`.

**Exactly one required (URL config):**
- `LETTERBOXD_URL` — single URL (backward compat)
- `LETTERBOXD_URLS` — comma-separated list of URLs (multi-source)

**Always required:**
- `SEERR_API_URL`
- `SEERR_API_KEY`

**Always optional:**
- `PORT` — defaults to `3000`; status/control HTTP server port
- `FLARESOLVERR_URL`, `BYPARR_URL` — used as fallback for Cloudflare-protected request-mode pages
- `MEDIA_MOUNT_SENTINEL` — defaults to `/mnt/media/.MOUNT_OK`, required at runtime for delete mode deletes to proceed
- `DRY_RUN` — defaults to `false`; when `true`, no API mutations occur and state is not persisted (exception: delete mode first run still saves its bootstrap state)
- `CHECK_INTERVAL_MINUTES` — defaults to `10`, minimum `1`
- `DATA_DIR` — defaults to `/data`
- `LETTERBOXD_TAKE_AMOUNT` + `LETTERBOXD_TAKE_STRATEGY` — must be set together if used; apply to all request-mode sources

## Architecture

### Entrypoint (`src/index.ts`)
- `runAllSources()` iterates over all configured URLs sequentially each tick
- `startScheduledMonitoring()` runs `runAllSources()` immediately on startup then on interval
- Mode is derived per-URL from the URL pattern
- State is loaded once per tick from `DATA_DIR/sync-state.json`, saved once at the end

### Status server (`src/server.ts`)
- `startServer(port, runAllSources)` — starts an Express HTTP server
- `GET /status` — returns current sync state (sources, item counts by status, rssEtag, mode)
- `POST /sync` — triggers an immediate `runAllSources()` run; returns 202 Accepted or 409 if already running
- No auth (homelab LAN)

### Scraping (`src/scraper/`)
- `index.ts` — detects URL type and routes to the correct scraper
- `rss.ts` — used for delete-mode URLs (watched/diary); fetches `/{username}/rss/`, parses XML, extracts `<tmdb:movieId>` directly — no Cloudflare issues, no individual movie page visits
- `list.ts` — used for request-mode URLs; paginates HTML list pages; uses FlareSolverr/Byparr fallback on 403
- `movie.ts` — fetches individual movie pages to extract TMDb/IMDb IDs for request-mode sources
- `collections.ts`, `popular.ts` — AJAX-based scrapers for their respective URL types

### Seerr API (`src/api/seerr.ts`)
- `createMovieRequest(tmdbId)` — request mode
- `getMediaIdByTmdbId(tmdbId)` — resolves Seerr's internal media ID from a TMDb ID
- `deleteMediaFile(mediaId)` — `DELETE /media/{id}/file`, removes from Radarr (requires ADMIN key)
- `deleteMedia(mediaId)` — `DELETE /media/{id}`, removes Seerr record (requires MANAGE_REQUESTS)

### State (`src/util/state.ts`)
- Persists `sync-state.json` in `DATA_DIR`
- **V2 format**: `{ version: 2, sources: Record<url, SourceState> }`
- Each `SourceState` has: `url`, `mode`, `rssEtag?`, `items`
- Item statuses: `pending`, `cleanupPending`, `acknowledged`, `skipped`
- `seerrMediaId` stored on items so `cleanupPending` retries can call `deleteMedia()` directly without re-lookup
- **V1 migration**: V1 state (`{ version: 1, mode, items }`) is auto-migrated on first load using the first configured URL as the source key

### Mount Safety (`src/util/mount.ts`)
- `mountSentinelExists()` gates all destructive deletes
- `cleanupPending` retries (Seerr-only) are **not** blocked by the sentinel check — only the `deleteMediaFile` step is gated

## Behavior Notes

- **First delete-mode run** bootstraps all current watched items as `acknowledged` without deleting anything. This runs per-source in V2.
- **cleanupPending**: if `deleteMediaFile` succeeds but `deleteMedia` fails, item becomes `cleanupPending` with `seerrMediaId` stored. Retried on next run independently of the current source list.
- **TMDb-missing items** use a bounded retry cap of 3 before becoming `skipped`.
- **Transient API failures** stay retryable and do not increment the bounded retry counter.
- **Mode mismatch** (e.g. switching a URL from request to delete): that source's state resets and first-run bootstrap runs again.
- **Removed URLs**: if a URL is removed from config, its `SourceState` stays in the file but is never processed.
- **Cross-source overlap**: if the same movie appears as pending in multiple sources simultaneously (rare, transient), a warning is logged. No suppression.
