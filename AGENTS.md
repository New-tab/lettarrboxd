# AGENTS.md

Read `CLAUDE.md` first for the existing project overview, commands, architecture, and module layout.
When `AGENTS.md` and `CLAUDE.md` differ, follow `AGENTS.md`.

## Project Purpose

This repo started as Lettarrboxd, a TypeScript Node.js app that syncs Letterboxd watchlist movies to Radarr.

For this project, the target behavior is different:

1. **Watchlist additions**
   - New movies from Letterboxd should be sent to **Seerr** as requests
   - Do **not** add watchlist movies directly to Radarr

2. **Watched / diary deletions**
   - When a film is marked watched or appears in the diary flow, delete it from **Radarr first**
   - After Radarr deletion succeeds, delete the matching **Seerr request**
   - Never reverse this order

## Critical Behavioral Rules

### Request flow
- Letterboxd watchlist addition -> Seerr request creation
- Preserve existing Letterboxd scraping, pagination, TMDb resolution, and state tracking where possible

### Deletion flow
- Resolve the movie to the correct TMDb ID
- Find the movie in Radarr
- Delete in Radarr first
- Then remove the matching request from Seerr

### Radarr delete policy
Use:
- `deleteFiles=true`
- `addImportExclusion=false`

Reason:
- These deletions come from Letterboxd completion logic
- Future re-requests should remain possible without clearing Radarr import exclusions

### Seerr cleanup
After a successful Radarr delete, remove the corresponding Seerr request record so Seerr stays in sync and future re-requests are not blocked by stale request state.

### Mount safety
Before any deletion logic runs, require the mount sentinel:
- `/mnt/media/.MOUNT_OK`

If that file is missing:
- abort deletion
- log loudly
- do not attempt destructive operations

### qBittorrent
- Do **not** add qBittorrent API logic unless explicitly requested
- Existing hardlink + ratio-limit setup is assumed to handle seeding independently of library deletion

## Engineering Preferences

- Prefer the **smallest viable patch**
- Reuse the existing Lettarrboxd scraping/state/scheduler architecture where sensible
- Do not rewrite large parts of the app unless necessary
- Keep env validation strict through `src/env.ts`
- Keep Docker deployment simple
- Keep logs explicit and useful
- Favor understandable code over clever abstractions

## Likely Files of Interest

- `src/index.ts` - scheduling and orchestration
- `src/letterboxd.ts` - scraping and TMDb extraction
- `src/radarr.ts` - Radarr integration
- `src/env.ts` - env validation

You may introduce new modules for:
- `src/seerr.ts`
- watched/diary processing
- mount safety checks

## Validation

After code changes, make a best effort to run the relevant checks:

- `yarn tsc --noEmit`
- `yarn build`

If tests exist or are added, run them too.

## First-task priority

Before writing code:
1. Identify where watchlist scraping currently happens
2. Identify where TMDb IDs are resolved
3. Identify the current Radarr add/delete integration points
4. Identify where persistent state is stored
5. Propose the smallest patch plan
6. Then implement
