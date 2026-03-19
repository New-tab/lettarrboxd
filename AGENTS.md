# AGENTS.md

Read `CLAUDE.md` first. If documentation conflicts with the code, treat the code as the source of truth.

## Repo role

Seerrboxd is a TypeScript Node.js app that monitors one or more Letterboxd sources on a schedule and syncs them into a Seerr-centered movie workflow.

- **Request mode** (watchlist, lists, filmographies): creates Seerr movie requests.
- **Delete mode** (diary URL): deletes movies from Radarr via Seerr when they appear in the diary RSS feed.

## Required behavior

### Request flow
- New Letterboxd watchlist movies must be sent to **Seerr**
- Do **not** add watchlist movies directly to Radarr

### Delete flow
For diary-logged movies (delete mode uses `/diary/` URL via RSS):
1. `DELETE /api/v1/media/{id}/file` via Seerr — removes from Radarr (requires ADMIN key)
2. `DELETE /api/v1/media/{id}` via Seerr — removes Seerr record (requires MANAGE_REQUESTS)

Radarr is never contacted directly. All delete operations go through the Seerr API.
Never reverse that order.

### Mount safety
Never run destructive deletion unless mount safety passes.
Assume `/mnt/media/.MOUNT_OK` is the preferred sentinel.

### qBittorrent
Do not add qBittorrent API logic unless explicitly requested.

## Engineering preferences

- preserve the existing scheduler/scraping/state logic where sensible
- prefer the smallest viable patch
- keep env validation strict
- keep logging clear
- avoid broad rewrites unless necessary
- understandable code beats clever abstractions

## Key files

- `src/index.ts` — `runAllSources()`, scheduler, request/delete mode routing
- `src/server.ts` — Express status server (`GET /status`, `POST /sync`)
- `src/scraper/index.ts` — URL detection, mode routing, `fetchMoviesFromUrl()`
- `src/scraper/rss.ts` — RSS scraper with ETag support; used for delete mode
- `src/scraper/list.ts` — HTML scraper with FlareSolverr/Byparr fallback; request mode
- `src/api/seerr.ts` — `createMovieRequest`, `getMediaIdByTmdbId`, `deleteMediaFile`, `deleteMedia`
- `src/util/env.ts` — Zod env validation; produces `letterboxdUrls: string[]`
- `src/util/state.ts` — V2 state format, migration, persistence
- `src/util/mount.ts` — mount sentinel safety check

## Validation

After edits, run:
- `yarn test:unit`
- `yarn build`
