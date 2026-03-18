# Lettarrboxd

Sync a single Letterboxd source into a Seerr-centered movie workflow.

## Overview

The approved v1 workflow is:

- watchlist additions -> Seerr request creation
- watched/diary entries -> Radarr delete first, then Seerr request cleanup

## Confirmed Runtime Behavior

- Watchlists create Seerr requests, not direct Radarr adds.
- Watched movies (`/films/`) and diary (`/films/diary/`) run in delete mode.
- Delete mode first run bootstraps existing watched/diary entries without deleting historical items.
- Radarr deletion uses `deleteFiles=true` and `addImportExclusion=false`.
- Destructive deletes are blocked unless the mount sentinel exists at `/mnt/media/.MOUNT_OK` by default.
- State is persisted in `DATA_DIR/sync-state.json`.
- Each instance tracks its own state, so run separate containers/processes with separate `DATA_DIR`s.
- `DRY_RUN=true` performs no API mutations and does not persist state.

## Documented v1 Sources

The documented v1 workflow in this README is anchored to these Letterboxd sources:

- Watchlists: `https://letterboxd.com/username/watchlist/`
- Watched movies: `https://letterboxd.com/username/films/`
- Diary: `https://letterboxd.com/username/films/diary/`

## Additional Runtime-Recognized URLs

The current code also recognizes these URL types, but they are outside the documented v1 workflow/examples in this README:

- Regular lists: `https://letterboxd.com/username/list/list-name/`
- Collections: `https://letterboxd.com/films/in/collection-name/`
- Popular movies: `https://letterboxd.com/films/popular/`
- Actor filmography: `https://letterboxd.com/actor/actor-name/`
- Director filmography: `https://letterboxd.com/director/director-name/`
- Writer filmography: `https://letterboxd.com/writer/writer-name/`

## Environment

### Required for watchlist request mode

| Variable | Description | Example |
|----------|-------------|---------|
| `LETTERBOXD_URL` | Letterboxd source URL | `https://letterboxd.com/your_username/watchlist/` |
| `SEERR_API_URL` | Seerr base URL | `http://seerr:5055` |
| `SEERR_API_KEY` | Seerr API key | `your_seerr_api_key` |

### Also required for watched/diary delete mode

| Variable | Description | Example |
|----------|-------------|---------|
| `RADARR_API_URL` | Radarr base URL | `http://radarr:7878` |
| `RADARR_API_KEY` | Radarr API key | `your_radarr_api_key` |

### Common optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECK_INTERVAL_MINUTES` | `10` | Poll interval in minutes (minimum 10) |
| `DATA_DIR` | `/data` | Directory used for `sync-state.json` |
| `MEDIA_MOUNT_SENTINEL` | `/mnt/media/.MOUNT_OK` | Sentinel required before delete-mode mutations |
| `LETTERBOXD_TAKE_AMOUNT` | - | Optional limit on number of movies to process |
| `LETTERBOXD_TAKE_STRATEGY` | - | Required with `LETTERBOXD_TAKE_AMOUNT`; `newest` or `oldest` |
| `DRY_RUN` | `false` | Log what would happen without mutating services or state |

## Docker

### Watchlist request-mode instance

```bash
docker run -d \
  --name lettarrboxd-watchlist \
  -e LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/ \
  -e SEERR_API_URL=http://seerr:5055 \
  -e SEERR_API_KEY=your_seerr_api_key \
  -e CHECK_INTERVAL_MINUTES=60 \
  -v ./data/watchlist:/data \
  ryanpage/lettarrboxd:latest
```

### Watched/diary delete-mode instance

```bash
docker run -d \
  --name lettarrboxd-watched \
  -e LETTERBOXD_URL=https://letterboxd.com/your_username/films/ \
  -e SEERR_API_URL=http://seerr:5055 \
  -e SEERR_API_KEY=your_seerr_api_key \
  -e RADARR_API_URL=http://radarr:7878 \
  -e RADARR_API_KEY=your_radarr_api_key \
  -e MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK \
  -e CHECK_INTERVAL_MINUTES=60 \
  -v ./data/watched:/data \
  ryanpage/lettarrboxd:latest
```

## Multiple Instances

Run one instance per Letterboxd source and give each instance its own `DATA_DIR`.

```yaml
services:
  lettarrboxd-watchlist:
    image: ryanpage/lettarrboxd:latest
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/
      - SEERR_API_URL=http://seerr:5055
      - SEERR_API_KEY=your_seerr_api_key
      - CHECK_INTERVAL_MINUTES=60
      - DATA_DIR=/data
    volumes:
      - ./data/watchlist:/data

  lettarrboxd-diary:
    image: ryanpage/lettarrboxd:latest
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/films/diary/
      - SEERR_API_URL=http://seerr:5055
      - SEERR_API_KEY=your_seerr_api_key
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_radarr_api_key
      - MEDIA_MOUNT_SENTINEL=/mnt/media/.MOUNT_OK
      - CHECK_INTERVAL_MINUTES=60
      - DATA_DIR=/data
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
- Confirm the Letterboxd source is public.
- Try `DRY_RUN=true` first to inspect intended behavior without mutating anything.

### Delete mode is not removing movies

- Verify `RADARR_API_URL` and `RADARR_API_KEY`.
- Confirm the mount sentinel exists at `/mnt/media/.MOUNT_OK` or at your custom `MEDIA_MOUNT_SENTINEL`.
- Remember that the first delete-mode run bootstraps state and does not delete historical entries.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

## Legal Disclaimer

This project is intended for use with legally sourced media only. Users are responsible for ensuring their use complies with applicable laws and regulations.
