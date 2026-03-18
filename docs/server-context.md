# Server Context for This Repo

This repo is being adapted for a specific home media server stack.

## Active request/download pipeline

User -> Seerr -> Radarr/Sonarr -> Prowlarr -> qBittorrent (through Gluetun) -> Radarr/Sonarr hardlink into library -> Jellyfin

For this project:
- movie requests should go through **Seerr**
- movie deletion should happen in **Radarr first**
- after Radarr deletion succeeds, the matching **Seerr request** should be deleted

## Important container/service facts

- Seerr container name: `seerr`
- Seerr URL in the stack: `http://seerr:5055`
- Radarr container name: `radarr`
- Radarr URL in the stack: `http://radarr:7878`
- qBittorrent is not addressed directly in normal Docker networking
- qBittorrent is reached via **Gluetun**
- qBittorrent UI/API host in the stack: `gluetun`
- qBittorrent UI/API URL pattern: `http://gluetun:8080`

## Media mount / hardlink model

The stack depends on all media containers sharing the same parent mount at the same container path:

- `/mnt/media:/media`

That includes qBittorrent, Radarr, Sonarr, and Jellyfin.

Important paths:
- downloads root: `/media/downloads`
- movie download category: `/media/downloads/radarr`
- TV download category: `/media/downloads/sonarr`
- movie library: `/media/movies`
- TV library: `/media/tv`

Radarr/Sonarr hardlink from downloads into the library. Deleting the library file does not necessarily stop qBittorrent from seeding, because the download-side hardlink can still exist until the torrent lifecycle completes.

## Seeding behavior

Current qBittorrent behavior in the stack:
- target seed ratio: `1.5`
- Radarr/Sonarr "Remove Completed": enabled

Implication:
- do not add new qBittorrent API logic unless explicitly requested
- assume existing hardlink + seeding setup is intentional

## Safety rule for deletion

Destructive deletion logic must not run unless the media mount is confirmed present.

Required sentinel/check:
- `/mnt/media/.MOUNT_OK` preferred sentinel file
- or equivalent mount verification logic if sentinel is not yet implemented

If mount safety fails:
- abort deletion
- log loudly
- do not attempt destructive operations

## Letterboxd-specific behavior desired in this repo

### Add flow
- Letterboxd watchlist additions should create **Seerr requests**
- do not add watchlist movies directly to Radarr

### Delete flow
When a movie is detected as watched/logged:
1. resolve the movie correctly
2. delete it from **Radarr first**
3. then delete the matching **Seerr request**

Radarr delete policy for this flow:
- `deleteFiles=true`
- `addImportExclusion=false`

Reason:
- these are Letterboxd-completion-driven deletes
- future intentional re-requests should remain possible without clearing Radarr import exclusions

## Notes for implementation

- preserve existing Letterboxd scraping, scheduling, and state logic where possible
- prefer minimal changes over rewrites
- keep Docker deployment simple
- if repo docs conflict with code, trust the code