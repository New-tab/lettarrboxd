# CLAUDE.md

This file describes the current code shape in this repository. If docs disagree with the code, trust the code.

## Project Overview

Lettarrboxd monitors a single Letterboxd source on a schedule and syncs it into a Seerr-centered movie workflow.

The runtime has two modes determined by `LETTERBOXD_URL`:

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (watched/diary URLs): deletes movies from Radarr via Seerr, then removes the Seerr media record. Radarr is never contacted directly.

## Commands

- `yarn start` - Run the compiled application
- `yarn start:dev` - Run with `nodemon`
- `yarn build` - Compile TypeScript
- `yarn test:unit` - Run unit tests (excludes integration tests)
- `yarn test` - Run all tests

## Environment Variables

Validated with Zod in `src/util/env.ts`.

**Always required:**
- `LETTERBOXD_URL`
- `SEERR_API_URL`
- `SEERR_API_KEY`

**Always optional:**
- `RADARR_API_URL`, `RADARR_API_KEY` — legacy, not used by any active code path
- `FLARESOLVERR_URL`, `BYPARR_URL` — used as fallback for Cloudflare-protected request-mode pages
- `MEDIA_MOUNT_SENTINEL` — defaults to `/mnt/media/.MOUNT_OK`, required at runtime for delete mode deletes to proceed
- `DRY_RUN` — defaults to `false`; when `true`, no API mutations occur and state is not persisted (exception: delete mode first run still saves its bootstrap state)
- `CHECK_INTERVAL_MINUTES` — defaults to `10`, minimum `10`
- `DATA_DIR` — defaults to `/data`
- `LETTERBOXD_TAKE_AMOUNT` + `LETTERBOXD_TAKE_STRATEGY` — must be set together if used

## Architecture

### Entrypoint (`src/index.ts`)
- `startScheduledMonitoring()` runs immediately on startup then on interval
- Mode is derived from `LETTERBOXD_URL`
- State is loaded from `DATA_DIR/sync-state.json`

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
- `deleteMovieRequestByTmdbId()` — legacy, no longer called by active code

### Radarr API (`src/api/radarr.ts`)
- No longer used by any active code path
- Legacy helpers remain but are not called

### State (`src/util/state.ts`)
- Persists `sync-state.json` in `DATA_DIR`
- Item statuses: `pending`, `cleanupPending`, `acknowledged`, `skipped`
- `seerrMediaId` stored on items so `cleanupPending` retries can call `deleteMedia()` directly without re-lookup

### Mount Safety (`src/util/mount.ts`)
- `mountSentinelExists()` gates all destructive deletes
- `cleanupPending` retries (Seerr-only) are **not** blocked by the sentinel check — only the `deleteMediaFile` step is gated

## Behavior Notes

- **First delete-mode run** bootstraps all current watched items as `acknowledged` without deleting anything.
- **cleanupPending**: if `deleteMediaFile` succeeds but `deleteMedia` fails, item becomes `cleanupPending` with `seerrMediaId` stored. Retried on next run independently of the current source list.
- **TMDb-missing items** use a bounded retry cap of 3 before becoming `skipped`.
- **Transient API failures** stay retryable and do not increment the bounded retry counter.
- **Mode mismatch** (e.g. switching from request to delete URL): state resets and first-run bootstrap runs again.

## v2 Notes (not yet implemented)

- **Multi-URL support**: run one container monitoring multiple URLs simultaneously. Needed to safely handle the case where a movie is on a monitored request-mode list and also appears on the watched list — without the two modes fighting each other.
