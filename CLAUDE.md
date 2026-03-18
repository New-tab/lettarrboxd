# CLAUDE.md

This file describes the current code shape in this repository. If docs disagree with the code, trust the code.

## Project Overview

Lettarrboxd monitors a single Letterboxd source on a schedule and syncs it into a Seerr-centered movie workflow.

The active runtime has two modes:

- Request mode: request-mode Letterboxd sources create Seerr movie requests.
- Delete mode: watched/diary sources delete from Radarr first, then delete the matching Seerr request.

## Commands

### Development

- `yarn start` - Run the compiled application
- `yarn start:dev` - Run with `nodemon`
- `yarn build` - Compile TypeScript
- `yarn test:unit` - Run unit tests
- `yarn test:integration` - Run integration tests
- `yarn test` - Run all tests

## Environment Configuration

Environment variables are validated with Zod in `src/util/env.ts`.

Always required:

- `LETTERBOXD_URL`
- `SEERR_API_URL`
- `SEERR_API_KEY`

Required only for watched/diary delete mode:

- `RADARR_API_URL`
- `RADARR_API_KEY`

Important defaults and rules:

- `CHECK_INTERVAL_MINUTES` defaults to `10` and must be at least `10`
- `DATA_DIR` defaults to `/data`
- `MEDIA_MOUNT_SENTINEL` defaults to `/mnt/media/.MOUNT_OK`
- `DRY_RUN=true` performs no API mutations and does not persist state
- `LETTERBOXD_TAKE_AMOUNT` and `LETTERBOXD_TAKE_STRATEGY` must be set together

## Runtime Architecture

### Entrypoint

- `src/index.ts`
  - `startScheduledMonitoring()` runs immediately on startup and then on an interval
  - mode is derived from `LETTERBOXD_URL`
  - current state is loaded from `DATA_DIR/sync-state.json`

### Scraping

- `src/scraper/index.ts`
  - detects supported Letterboxd URL types
  - maps watched/diary sources to delete mode
- `src/scraper/list.ts`
  - paginates list-like Letterboxd pages and collects movie links
- `src/scraper/movie.ts`
  - fetches individual movie pages and extracts Letterboxd ID, TMDb ID, IMDb ID, and year

### External APIs

- `src/api/seerr.ts`
  - `createMovieRequest()` creates movie requests in Seerr
  - `deleteMovieRequestByTmdbId()` finds and deletes matching Seerr requests
- `src/api/radarr.ts`
  - `findMovieByTmdbId()` resolves an existing Radarr movie
  - `deleteMovieById()` deletes with `deleteFiles=true` and `addImportExclusion=false`
  - legacy Radarr add helpers still exist in this module, but the active request flow does not call them

### State

- `src/util/state.ts`
  - persists `sync-state.json`
  - state is per-instance and isolated by `DATA_DIR`
  - supported statuses are:
    - `pending`
    - `cleanupPending`
    - `acknowledged`
    - `skipped`

### Delete-Mode Safety

- `src/util/mount.ts`
  - `mountSentinelExists()` checks the sentinel path before destructive deletes
- delete mode never mutates Radarr unless the sentinel exists
- the first delete-mode run bootstraps historical watched/diary items without deleting them

## Behavior Notes

- Request mode acknowledges movies after successful Seerr creation or an "already exists" response.
- Delete mode deletes from Radarr first, then cleans up Seerr.
- If Radarr delete succeeds but Seerr cleanup fails, the item becomes `cleanupPending` and is retried from state later even if it disappears from the current Letterboxd source.
- TMDb-missing items and Radarr-match misses use a bounded retry cap of 3 before becoming `skipped`.
- Transient API failures remain retryable and do not increment the bounded retry counter.
