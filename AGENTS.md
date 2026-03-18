# AGENTS.md

Read these files first, in this order:

1. `CLAUDE.md`
2. `docs/server-context.md`
3. `docs/home-server-v7.1.md`

If documentation conflicts with the code, treat the code as the source of truth.

## Repo role

This repo started as Lettarrboxd, a TypeScript Node.js app that syncs Letterboxd watchlist movies to Radarr.

For this project, that behavior is being adapted to a Seerr-centered media stack.

## Required behavior

### Request flow
- New Letterboxd watchlist movies must be sent to **Seerr**
- Do **not** add watchlist movies directly to Radarr

### Delete flow
For watched/logged movies:
1. delete from **Radarr first**
2. then delete the matching **Seerr request**

Never reverse that order.

### Radarr delete flags
Use:
- `deleteFiles=true`
- `addImportExclusion=false`

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

## First-task instructions for Codex

Before editing code:
1. identify the real current entrypoints and imports
2. identify where Letterboxd scraping happens
3. identify where TMDb resolution happens
4. identify where Radarr add/delete calls happen
5. identify where persistent state is stored
6. identify whether watched/diary support already exists anywhere
7. propose the smallest implementation plan

Only then should code changes begin.

## Expected likely files

The current code may not match older docs exactly.
Expect to inspect files such as:
- `src/index.ts`
- `src/scraper.ts`
- `src/api/radarr.ts`
- `src/util/env.ts`
- `src/util/logger.ts`

Potential new files/modules are acceptable if they keep the patch small, for example:
- `src/api/seerr.ts`
- watched/diary processing helpers
- mount safety helpers

## Validation

After edits, run the relevant checks if available:
- `yarn tsc --noEmit`
- `yarn build`

Run tests too if they exist.