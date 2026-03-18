# Home Server v7.1 — Living Document

**Last updated:** 2026-03-17 (v7.1)
**Hardware:** ThinkPad T420s (i5-2520M, Sandy Bridge, 4GB RAM)
**Hostname:** nucleus
**OS:** Debian 13 "Trixie" Stable (kernel 6.12 LTS)

### v7.1 Changes
- **JellyBridge retired from the active stack** on 2026-03-17. The Jellyfin Discover library was removed, the plugin was uninstalled, and Jellyfin no longer needs the `/srv/appdata/jellybridge:/jellybridge` mount.
- **Temporary rollback posture:** the live `/srv/appdata/jellybridge` directory is being left in place briefly before final deletion, but it is no longer part of normal operations.
- **Document cleanup:** removed JellyBridge-specific workflow notes, rename workarounds, and Seerr/Jellyfin caveats that no longer apply.

---

## Current System State

### Boot & OS
- **Debian 13 "Trixie"** installed via netinst ISO, flashed with balenaEtcher.
- **Boot mode:** Legacy BIOS (not UEFI). UEFI on the T420s is early-generation and finicky; Legacy is simpler and more reliable on this hardware.
- **Secure Boot:** Disabled (not relevant in Legacy mode).
- **Boot drive (v6):** 512GB m.2 SATA drive (ADATA SU800NS38), installed in the internal **mSATA slot** via m.2-to-mSATA adapter. Migration from USB adapter completed 2026-03-17.
- **Partition layout (v6):** `sda1` (~473G ext4, starts at sector 2048) = Debian root, `sda2` (~4G) = swap. Clean MBR partition table — no extended partition wrapper. GRUB embeds properly in the 1MB gap before sector 2048 (no `--force`/blocklist needed).
- **Root UUID:** `a2943ea6-9e7f-460d-b242-4b0019688558`
- **Swap UUID:** `4f1298b2-b5b6-4efc-b2fb-424febb178be`
- **CMOS battery:** Dead (RTC error on boot). Cosmetic — NTP syncs the clock once online. Replace with CR2032 if desired, but the server runs 24/7 so it doesn't matter.
- **TPM error on boot:** Harmless, ignore.
- **BIOS settings:** Legacy boot mode. Cannot change boot order in BIOS (use F12 for one-time boot menu).

### Networking
- **Gigabit ethernet** hardwired to router. Interface negotiates at 1000 Mbps, confirmed with `ethtool`.
- **LAN throughput:** ~350 MB/s (confirmed with iperf3 between Mac and ThinkPad).
- **WAN throughput:** ~28 MB/s (224 Mbps) bare metal, tested against Debian CDN. Lower than the Mac's 924 Mbps — likely Sandy Bridge CPU overhead on TLS decryption.
- **Tailscale** installed and connected to tailnet. Server accessible via Tailscale IP (`100.75.106.19`) from anywhere.
- **Tailscale exit node:** Advertised and approved. Devices on the tailnet can route all traffic through the server's home internet connection.

### Users & Access
- **Non-root user** created during install, added to `sudo` and `docker` groups.
- **SSH access** works over both local LAN IP and Tailscale IP.

### Storage

**Boot SSD (512GB m.2 via internal mSATA):**
- `/srv/appdata` — Docker persistent volumes
- `/srv/vault` — Obsidian vault (future)

**10TB G-Technology G-DRIVE (USB SuperSpeed):**
- Reformatted to **ext4** (was HFS+ from Mac). Label: "media".
- Mounted at `/mnt/media` with fstab entry using UUID and `nofail` option.
- Reserved blocks set to 1% (`tune2fs -m 1`) — 0% is safe on a data drive but 1% gives the allocator breathing room at no practical cost.
- **G-DRIVE connection gotcha:** The drive has two USB-C ports on the back — one Thunderbolt, one SuperSpeed. The Thunderbolt port does NOT work properly through a USB-C to USB-A cable (enumerates as "low-speed," no block device created). **Always use the SuperSpeed port.**
- Directory structure:
  - `/mnt/media/movies` — Radarr imports (Jellyfin Movies library)
  - `/mnt/media/tv` — Sonarr imports (Jellyfin TV Shows library)
  - `/mnt/media/downloads` — qBittorrent active downloads
  - `/mnt/media/downloads/radarr/` — categorized movie downloads
  - `/mnt/media/downloads/sonarr/` — categorized TV downloads

**Not yet connected:**
- `/mnt/backup` — 10TB backup drive (ExpressCard USB 3.0)
- `/mnt/storage` — multi-bay enclosure (native USB 3.0)

### Directory Layout Rationale
- `/srv` = data the server actively serves (on boot SSD): appdata, vault
- `/mnt` = mount points for external drives: media, backup, storage
- Original plan had `/srv/media` — restructured because it's inconsistent to put an external drive mount point under `/srv`.

---

## DNS Architecture

The server has two completely separate DNS paths — one for Docker containers and one for end-user devices. Understanding this separation is important for troubleshooting.

### Docker Container DNS (Quad9 direct — no ad-blocking)
Every container in the compose file (except qBittorrent and AdGuard) has an explicit DNS block:
```yaml
dns:
  - 9.9.9.10
  - 149.112.112.10
```
This sends container DNS queries directly to Quad9, completely bypassing AdGuard. This was originally needed because AdGuard on port 53 breaks Docker's internal DNS resolution, but it also means AdGuard's blocklists have zero influence on container operations. Radarr can reach indexers, Prowlarr can reach trackers, Jellyfin can reach TMDB — no risk of ad-blocking false positives breaking services.

**qBittorrent** doesn't have its own DNS block because `network_mode: "service:gluetun"` means it inherits Gluetun's entire network stack, including Gluetun's DNS settings. **AdGuard** doesn't need one because it is the DNS server.

### End-User Device DNS (AdGuard via Tailscale — ad-blocking active)
Configured in the Tailscale admin console (`https://login.tailscale.com/admin` → DNS):

**Split DNS entry:** `nucleus` domain → `100.75.106.19` (server's Tailscale IP). "Use with exit node" = **ON**. This ensures `*.nucleus` hostnames (used by the reverse proxy) always resolve to the server regardless of exit node state. Processed before blocklist filtering — the `*.nucleus` wildcard rewrite in AdGuard takes priority over any filtering rules.

**Global nameserver:** `100.75.106.19`. "Override DNS servers" = **ON**. "Use with exit node" = **OFF**. Routes all DNS from tailnet devices through AdGuard for ad-blocking. Drops out when a device activates an exit node (home or Mullvad), which disables ad-blocking but preserves `*.nucleus` resolution via the split DNS entry.

**Ad-blocking toggle design:** Activating an exit node in the Tailscale app on any device disables ad-blocking for that device (global nameserver drops out) while preserving access to all `*.nucleus` services (split DNS stays active). Deactivating the exit node re-enables ad-blocking. This is a single-tap toggle in the Tailscale iOS/macOS app.

**Critical server-side requirement (v5):** On **Nucleus itself**, Tailscale DNS must be disabled with `sudo tailscale set --accept-dns=false`. If `accept-dns` is enabled on the server, exit-node client DNS loops back through AdGuard and defeats the toggle design. With `accept-dns=false`, normal internet DNS from exit-node clients no longer appears in AdGuard, but `*.nucleus` split-DNS queries still do.

### AdGuard Home Configuration
- **Upstream DNS:** `https://dns10.quad9.net/dns-query` (Quad9 unfiltered, no malware blocking, no DNSSEC validation). Chosen to avoid false positives from Quad9's filtered service blocking torrent-related domains.
- **DNS rewrite:** `*.nucleus` → `100.75.106.19` (wildcard — all `.nucleus` subdomains resolve to the server). New services added to the Caddyfile automatically work without touching DNS.
- **Persistent clients:** Configured in Settings → Client Settings using each device's Tailscale IP. After the v5 host-network migration, direct/split-DNS queries now show the real Tailscale client instead of Docker bridge addresses.
- **Network mode (v5):** AdGuard now runs in **Docker host networking mode**. This fixed the old `172.18.0.1` masking problem and made per-device attribution work properly for devices like the MacBook and iPhone.
- **Exit-node attribution tradeoff:** The chosen long-term preference is to keep the convenient exit-node ad-block toggle. That means general DNS from exit-node clients intentionally bypasses AdGuard and therefore will not appear in the query log, while `*.nucleus` queries still do.
- **Volume mount fix (v4):** The original compose file mapped config to `/opt/adguardhome/confdir` — AdGuard actually expects `/opt/adguardhome/conf`. The mismatch caused config to be stored in the container's ephemeral filesystem, which was destroyed when the container was recreated. Now correctly mapped to `/opt/adguardhome/conf`.

---

## Reverse Proxy (Caddy)

Caddy listens on port 80 and routes requests to the correct service based on the hostname. Combined with the `*.nucleus` DNS rewrite in AdGuard, this eliminates the need to remember IP addresses and port numbers.

### Service URLs

| URL | Routes to | Upstream |
|---|---|---|
| `http://jellyfin.nucleus` | Jellyfin | `jellyfin:8096` |
| `http://radarr.nucleus` | Radarr | `radarr:7878` |
| `http://sonarr.nucleus` | Sonarr | `sonarr:8989` |
| `http://seerr.nucleus` | Seerr | `seerr:5055` |
| `http://prowlarr.nucleus` | Prowlarr | `prowlarr:9696` |
| `http://qbit.nucleus` | qBittorrent | `gluetun:8080` |
| `http://adguard.nucleus` | AdGuard Home | `host.docker.internal:3000` |

**Note on qBittorrent:** Routes to `gluetun:8080` because qBittorrent shares Gluetun's network namespace — it's only reachable via Gluetun's container name.

**Note on AdGuard (v5):** AdGuard now runs in **host networking mode**, so it no longer has a normal Docker bridge IP. Caddy remains on the default Docker network and reaches AdGuard through `host.docker.internal:3000`, enabled by `extra_hosts: ["host.docker.internal:host-gateway"]` in the Caddy service. Direct host access is `http://<server-ip>:3000` if Caddy is down. The old `8880` backdoor is gone.

### Caddyfile Location
`/home/allen/server/caddy/Caddyfile`

### HTTPS (Future)
Currently all services are HTTP-only. Two options for HTTPS in the future:
- **Real domain (~$2-10/year):** Buy a cheap domain, set up wildcard DNS pointing at Tailscale IP, Caddy auto-issues Let's Encrypt certificates via DNS challenge. Browsers trust it natively, no `http://` prefix needed.
- **Caddy internal CA (free):** Caddy generates certificates signed by its own root CA. Requires installing Caddy's root certificate on each device. Free and self-contained but requires one-time cert install per device.

### Search Domains (Future Polish)
Adding `nucleus` as a search domain in Tailscale would allow typing just `jellyfin` (without `.nucleus`) in the browser. The OS appends the search domain automatically. Not configured yet — polish for later.


---

## Docker Services

All services defined in `~/server/docker-compose.yml`. Compose file location: `/home/allen/server/`.

### Running Services (11 containers)

| Container | Image | Port | Friendly URL | Purpose |
|---|---|---|---|---|
| caddy | caddy:2 | 80 | — | Reverse proxy |
| adguard | adguard/adguardhome | 53 (DNS), 3000 (admin) | `adguard.nucleus` | DNS-level ad blocking |
| jellyfin | jellyfin/jellyfin | 8096 | `jellyfin.nucleus` | Media server |
| gluetun | qmcgaw/gluetun | 8080 (qBittorrent UI) | `qbit.nucleus` | VPN gateway (WireGuard → ProtonVPN) |
| qbittorrent | linuxserver/qbittorrent | (via gluetun) | `qbit.nucleus` | Torrent client |
| prowlarr | linuxserver/prowlarr | 9696 | `prowlarr.nucleus` | Indexer manager |
| radarr | linuxserver/radarr | 7878 | `radarr.nucleus` | Movie management |
| sonarr | linuxserver/sonarr | 8989 | `sonarr.nucleus` | TV show management |
| seerr | ghcr.io/seerr-team/seerr | 5055 | `seerr.nucleus` | Media request UI |
| flaresolverr | ghcr.io/flaresolverr/flaresolverr | 8191 | — | Cloudflare bypass helper |
| byparr | ghcr.io/thephaseless/byparr | 8192 (host) / 8191 (internal) | — | Alternate Cloudflare bypass helper |

### Service Interconnections (the pipeline)

```
User → Seerr (request movie/show)
         ↓
    Radarr / Sonarr (search for release)
         ↓
    Prowlarr → FlareSolverr or Byparr (query indexers, bypass Cloudflare)
         ↓
    qBittorrent ← Gluetun (download through VPN tunnel)
         ↓
    Radarr / Sonarr (hardlink to library)
         ↓
    Jellyfin (stream to devices)
```

### Volume Mount Architecture

**Critical lesson learned (v4):** All containers that need access to media files must mount the **same parent directory at the same container path**. This enables hardlinks (instant, zero-copy imports) and ensures path consistency between services.

- **qBittorrent, Radarr, Sonarr, Jellyfin** all mount `/mnt/media:/media`
- qBittorrent downloads to `/media/downloads/radarr/` and `/media/downloads/sonarr/`
- Radarr hardlinks completed downloads from `/media/downloads/radarr/` to `/media/movies/`
- Sonarr hardlinks completed downloads from `/media/downloads/sonarr/` to `/media/tv/`
- Jellyfin reads from `/media/movies/` and `/media/tv/`
- Because both the download and library paths are on the same filesystem mount, Radarr/Sonarr use **hardlinks** instead of copies. The import is instant and uses zero additional disk space. The file appears in two locations but only occupies space once. qBittorrent keeps seeding from the downloads path while Jellyfin plays from the library path — same physical data on disk.

**Previous bug (v3):** qBittorrent mounted `/mnt/media/downloads:/downloads` while Radarr/Sonarr mounted `/mnt/media:/media`. The path mismatch meant qBittorrent reported files at `/downloads/radarr/...` but Radarr looked for them at `/media/downloads/radarr/...`. Imports failed. Fixed by giving qBittorrent the same wide mount as the other services.

**Volume mount auditing:** To verify mounts match what an application expects, check the image's documentation on Docker Hub or GitHub. For linuxserver.io images, the config path is always `/config`. For official images, each project defines its own paths — use `docker inspect imagename | grep -A 10 "Volumes"` to see declared volume paths. Always ensure the container path in your compose file matches what the application actually writes to. The AdGuard `confdir` vs `conf` bug was caused by this mismatch.

### Jellyfin
- **Server name:** axon
- **User:** enteraname
- **Remote connections:** Enabled.
- **External URL (in Seerr):** `http://jellyfin.nucleus` (updated from Tailscale IP to use reverse proxy hostname).
- **Libraries configured:**
  - Movies → `/media/movies` (container path; maps to `/mnt/media/movies` on host)
  - TV Shows → `/media/tv` (container path; maps to `/mnt/media/tv` on host)
- **Movies/TV library settings:**
  - Real-time monitoring: enabled
  - Metadata downloaders: TheMovieDb (primary), The Open Movie Database (fallback)
  - Image fetchers: TheMovieDb
  - Automatically add to collection: enabled
  - Save artwork into media folders: disabled (keeps media dirs clean)
  - Prefer embedded titles over filename: disabled (Radarr/Sonarr naming is more reliable)
  - Trickplay image extraction: **disabled** (CPU-intensive, Sandy Bridge would struggle — enable later)
  - Chapter image extraction: **disabled** (same reason — enable later)
  - Metadata savers (Nfo): disabled
  - For TV Shows: season folders enabled, automatic merge of series across folders disabled, prefer embedded episode info disabled
- **Transcoding note:** Sandy Bridge Quick Sync only supports H.264. H.265 requires software transcoding which will be slow. Prefer direct-play capable clients.
- **Jellyfin config files are owned by root** because the official `jellyfin/jellyfin` image runs as root internally (unlike linuxserver.io images which respect PUID/PGID). Need `sudo` to hand-edit config files at `/srv/appdata/jellyfin/`.

### Retired Component: JellyBridge (removed in v7.1)
- **Previous role:** Jellyfin-side discovery/request bridge to Seerr using a virtual Discover library.
- **Why it was removed:** It added ongoing fragility (placeholder-library edge cases, empty provider-ID tag bugs, extra cleanup steps) without being core to the main Seerr → Radarr/Sonarr → Jellyfin workflow.
- **Removal state:** Jellyfin now runs only the normal Movies and TV Shows libraries. The old JellyBridge appdata is being kept briefly as a rollback cushion, but it is no longer mounted into Jellyfin or treated as part of the active stack.
- **If re-evaluated later:** restore the Jellyfin plugin, recreate the Discover library, and re-add the `/srv/appdata/jellybridge:/jellybridge` mount to the Jellyfin service.


### Gluetun (VPN Gateway)
- **VPN provider:** ProtonVPN (Plus plan, ~6 months remaining on subscription)
- **VPN protocol:** WireGuard
- **WireGuard key (v6):** Regenerated on 2026-03-17 after the previous key was exposed in a Claude conversation on 2026-03-16. Current key is clean.
- **Server selection:** `SERVER_COUNTRIES=United States`, `PORT_FORWARD_ONLY=on`. Gluetun auto-selects the best available P2P-enabled server.
- **Port forwarding:** Enabled via `VPN_PORT_FORWARDING=on`. ProtonVPN assigns a random forwarded port via NAT-PMP.
- **Automatic port sync to qBittorrent:** Configured via `VPN_PORT_FORWARDING_UP_COMMAND` and `VPN_PORT_FORWARDING_DOWN_COMMAND` environment variables. When Gluetun gets a new port, it immediately pushes it to qBittorrent's API at `127.0.0.1:8080` (works because they share a network namespace). Requires "Bypass authentication for clients on localhost" enabled in qBittorrent's Web UI settings.
- **Known log quirk:** The UP_COMMAND logs an `ERROR` line (`[0/0] -> "-" [1]`) even on success. This is because qBittorrent's `setPreferences` endpoint returns an empty response body, and wget treats empty responses as failures. The port update works correctly despite the error label. Don't add `; true` to suppress it — that would hide real failures too.
- **Kill switch:** Built-in. qBittorrent has `network_mode: "service:gluetun"`, meaning it has no network interface of its own. If the VPN drops, qBittorrent loses all connectivity instantly. There is no fallback path to the regular internet.

### VPN Performance (OpenVPN vs WireGuard)
- **OpenVPN on Sandy Bridge:** ~300 KB/s (2.4 Mbps). Catastrophically slow. OpenVPN runs single-threaded in userspace — the 2011 CPU can't keep up with the encryption overhead.
- **WireGuard on Sandy Bridge:** ~10.8 MB/s (86 Mbps). 36x improvement. WireGuard runs in-kernel with modern, efficient cryptography. More than sufficient for torrenting and streaming.
- **Lesson:** Always use WireGuard over OpenVPN on older hardware. The performance difference is not marginal — it's the difference between usable and unusable.

### qBittorrent
- **Network mode:** `service:gluetun` (shares Gluetun's network namespace entirely — no separate network, no ports section, inherits Gluetun's DNS)
- **Web UI port:** 8080 (declared on Gluetun container, not qBittorrent)
- **Volume mount (v4):** `/mnt/media:/media` — same wide mount as Radarr/Sonarr/Jellyfin. Enables hardlinks and consistent path namespace across all containers.
- **Default Save Path:** `/media/downloads`
- **Category system:** Radarr sends downloads with category `radarr` → `/media/downloads/radarr/`. Sonarr uses category `sonarr` → `/media/downloads/sonarr/`. This keeps downloads organized and tells each service which completed downloads belong to it. The directories must actually exist on disk inside the shared `/media` mount or Radarr/Sonarr will warn that qBittorrent's reported download path does not exist.
- **Enable cookie Secure flag:** **Unchecked** (causes intermittent auth failures since all inter-container communication is plain HTTP)
- **Anonymous mode:** Enabled (strips client fingerprint from peer communications)
- **Seeding limits (verified 2026-03-17):** Ratio 1.5. qBittorrent keeps completed torrents long enough to seed to the limit; Radarr/Sonarr remove completed entries afterward.
- **Remove Completed in Radarr/Sonarr (verified 2026-03-17):** **Enabled.** In practice, completed torrents disappear from qBittorrent after the Arrs have imported them and the seed rule has been satisfied.
- **Sequential/First-Last downloading:** Disabled (hurts swarm efficiency, not needed for library-building workflow).
- **Max active downloads:** 5, max active torrents: 8, max active checking: 1 (single mechanical drive over USB — parallel hash checks would thrash the disk).
- **Default download client host in Radarr/Sonarr:** `gluetun` (not `qbittorrent` — because qBittorrent shares Gluetun's network, it's reachable via Gluetun's container name).
- **Relocating torrents after volume mount change:** If qBittorrent shows "missing files" after a mount change, select all affected torrents → right-click → Set location → update the path. qBittorrent rechecks files at the new path without re-downloading. Seeding state and progress are preserved.

### Prowlarr
- **Connected apps:** Radarr (Full Sync), Sonarr (Full Sync)
- **Prowlarr Server URL (in app connections):** `http://prowlarr:9696` (NOT `http://localhost:9696` — localhost from Radarr/Sonarr's perspective is their own container)
- **FlareSolverr connection:** `http://flaresolverr:8191`, tag: `flaresolverr`
- **Byparr connection (v5):** `http://byparr:8191`, tag: `byparr`
- **Proxy tagging rule:** Do **not** tag one indexer with both solver tags. Treat FlareSolverr and Byparr as A/B test targets, not chained fallbacks.
- **Public indexer lesson (v5):** Base URL / mirror choice matters at least as much as solver choice. LimeTorrents only started working after switching to a different base URL. Pirate Bay remained flaky across mirrors and both solvers. 1337x works intermittently.
- **FileMood note (v5):** Skipped for now because it requires category `8000 (Other)` sync, which broadens results too much for a clean movies/TV workflow.

### FlareSolverr
- **Status:** Working, but fragile. FlareSolverr is in an arms race with Cloudflare and the project has been deprecated/no longer actively maintained. It can still solve some targets (including 1337x intermittently), but success is inconsistent.
- **DNS fix required:** Explicit `dns` block in compose (same as other containers) due to AdGuard port 53 interference.

### Byparr (v5)
- **Purpose:** FlareSolverr-compatible alternative for A/B testing on Cloudflare-protected indexers.
- **Host test port:** `8192` on the host, `8191` internally on Docker.
- **Current verdict:** Worth having as a test tool, but not a magic fix. For some trackers, mirror/base-URL quality matters more than FlareSolverr vs Byparr.

### Seerr
- **Connected to:** Jellyfin (auth via enteraname account), Radarr, Sonarr
- **External URLs configured (v4):** Jellyfin (`http://jellyfin.nucleus`), Radarr (`http://radarr.nucleus`), Sonarr (`http://sonarr.nucleus`) — updated to use reverse proxy hostnames instead of Tailscale IP + port.
- **Seerr library scanning:** Only the normal Movies and TV Shows libraries are selected.
- **Permissions quirk:** Container runs as UID 1000 (rootless). If config dir has wrong ownership, fix with `sudo chown -R 1000:1000 /srv/appdata/seerr`.
- **Movie defaults:** Quality profile from Radarr, root folder `/media/movies`, minimum availability "Released", automatic search enabled, scan enabled.
- **TV defaults:** Season folders enabled, series type "Standard", anime series type "Anime", automatic search enabled, scan enabled.

---

## Services Not Yet Configured

| Service | Purpose | Status |
|---|---|---|
| CouchDB | Obsidian LiveSync database | Not started |
| Vaultwarden | Password manager (Bitwarden API) | Not started |
| Samba | SMB file shares | Not started |

---

## VPN Strategy (Two Separate Tools)

**Gluetun (server-side, container-level):**
- Wraps only qBittorrent's traffic in a VPN tunnel. Everything else (Jellyfin, Radarr, etc.) uses the regular internet connection.
- Currently using ProtonVPN Plus (WireGuard). ~6 months remaining on Proton subscription.
- When Proton expires: switch Gluetun to Mullvad standalone (~$5/month), OR renew Proton, OR evaluate alternatives.

**Tailscale Mullvad addon (device-level, future):**
- Different purpose entirely: lets any device on the tailnet (phone, laptop) browse the web through Mullvad while maintaining full tailnet access. No other VPN product can do this cleanly because most OSes only allow one VPN at a time.
- Not purchased yet. Defer until Proton subscription expires and the overall VPN strategy is reassessed.
- Available on Tailscale free Personal plan, monthly billing only (~$5/month).
- Note: With the current ad-blocking toggle design (Option A), DNS-level ad-blocking is disabled when any exit node (including Mullvad) is active. Browser-level ad blockers (uBlock Origin, 1Blocker for iOS) cover this gap. Mullvad handles both traffic and DNS when active, so no DNS leak.

---

## Playback Clients

### Current
- **Jellyfin web UI** — works in any browser on any platform. Primary desktop client for now.
- **Swiftfin** — official Jellyfin iOS client. Free, open source, improving but historically less polished than commercial alternatives.

### Future Options
- **Infuse Pro** — premium Jellyfin client for macOS/iOS/Apple TV (~$15/year or ~$75 lifetime). Connects to Jellyfin as a backend, handles its own metadata, excellent direct-play codec support (H.265 decoded locally on Apple hardware without server transcoding). Evaluate if Swiftfin's quality becomes a friction point. Does NOT integrate with Seerr — browse/request is still a separate workflow.
- **Streamyfin** — free iOS/Android Jellyfin client with native Seerr integration (browse, request, and play in one app). Uses MPV for playback. Has a companion Jellyfin server plugin for centralized settings and push notifications. iOS-only limitation for Apple users — no macOS client.

---

## Hardware Notes

### BIOS
- **Boot mode:** Legacy (leave as-is)
- **Secure Boot:** Disabled (irrelevant in Legacy mode)
- **RTC error:** Dead CMOS battery (CR2032). Cosmetic.
- **TPM error:** Harmless, ignore.

### mSATA Migration — Completed (v6)
Migration completed 2026-03-17. The original Debian installer created the partition table with `sda1` starting at **sector 2** — far too early for GRUB2, which needs ~1MB (2048 sectors) of embedding space before the first partition. Initial attempt with `grub-install` failed; `grub-install --force` worked via blocklists but is fragile. Full fix procedure:

1. Booted Debian netinst USB into rescue mode → "Execute a shell" (BusyBox environment)
2. BusyBox gotchas: `lsblk` not available (use `cat /proc/partitions`), `mount` needs explicit `-t ext4`
3. Mounted root partition and 10TB media drive
4. Backed up entire root filesystem: `tar cf /mediamnt/rootfs-backup.tar -C /rootfs .` (~25GB)
5. Repartitioned with `fdisk`: new MBR table, `sda1` starting at sector 2048 (root), `sda2` for 4GB swap (type `82`)
6. Formatted: `mkfs.ext4 /dev/sda1`, `mkswap /dev/sda2`
7. Restored: `tar xf /mediamnt/rootfs-backup.tar -C /rootfs`
8. Updated `/etc/fstab` UUIDs via `sed` (both root and swap changed because of reformat)
9. Chroot + `grub-install /dev/sda` — completed with **no warnings**, proper embedding confirmed
10. `update-grub`, reboot — clean boot from internal mSATA

**Key lesson:** Always start the first partition at sector 2048 on MBR disks. The Debian installer's auto-partitioner may not do this, especially when installing to USB-connected drives.

### G-DRIVE Connection
- **Model:** G-Technology G-DRIVE Thunderbolt 3 USB 3.1
- **Two USB-C ports on back:** Thunderbolt and SuperSpeed
- **MUST use the SuperSpeed port** with USB-C to USB-A cable. The Thunderbolt port enumerates as "low-speed" through a USB-C to USB-A cable — the kernel sees the enclosure but never creates a block device. This happens on both USB 3.0 (xhci) and USB 2.0 (ehci) controllers.


### Media Mount Failure Recovery — 2026-03-17
After the mSATA migration, the 10TB media drive (`/dev/sdb2`, label `media`) was visible to the kernel but **not mounted** at `/mnt/media`. Because Docker services were started anyway, qBittorrent and the Arrs wrote into the plain `/mnt/media` directory on the boot SSD instead of the real HDD mount. Symptoms:
- Radarr health error: `Missing root folder: /media/movies`
- qBittorrent reported widespread "missing files"
- Client-side browsing through Tailscale also failed until AdGuard was started, because tailnet devices use AdGuard on Nucleus for normal internet DNS

What actually happened:
- The live library on the 10TB disk was still intact
- A temporary set of shadow-written downloads landed on the SSD under `/mnt/media/downloads`
- One existing HDD file (`Decision.to.Leave...mkv`) turned out to be corrupt on disk (all-zero header) and was repaired by copying back the valid SSD-shadow copy

Recovery pattern that worked:
1. Stop the media stack
2. Inspect `/mnt/media` **before mounting** the real drive, and move any shadow-written files out of the way
3. Mount the real media drive back at `/mnt/media`
4. Restore only genuinely missing downloads from the SSD holding area to `/mnt/media/downloads`
5. Start `adguard`, then `gluetun`, `qbittorrent`, `caddy`, then the Arrs
6. For any stuck import, verify the file directly with Radarr's bundled ffprobe (`/app/radarr/bin/ffprobe`)

Prevention lesson:
- **Never start the media stack unless `findmnt /mnt/media` confirms the HDD is mounted**
- A future improvement is to add `x-systemd.automount` to the `/etc/fstab` entry for `/mnt/media` so USB timing at boot is less brittle

---

## Known Issues & Gotchas

1. **AdGuard breaks Docker DNS:** AdGuard on port 53 interferes with container DNS resolution. All services need explicit `dns: [9.9.9.10, 149.112.112.10]` in compose, except qBittorrent (inherits from Gluetun).
2. **qBittorrent DNS:** Cannot set `dns` on qBittorrent because `network_mode: "service:gluetun"` means it doesn't own its network stack. Set DNS on Gluetun instead.
3. **qBittorrent auth brute-force ban:** Repeated failed login attempts (e.g., from Radarr with wrong credentials) trigger a temporary IP ban. Fix: `docker compose restart qbittorrent`.
4. **qBittorrent cookie Secure flag:** Must be unchecked. Inter-container traffic is HTTP, not HTTPS. The Secure flag can cause intermittent authentication failures for Radarr/Sonarr API calls.
5. **Public tracker mirrors vary wildly (v5):** A broken default base URL can look like a Cloudflare/proxy failure. Try alternate base URLs before blaming FlareSolverr/Byparr.
6. **FlareSolverr deprecation:** Project is no longer actively maintained. Works sometimes but may break as Cloudflare updates detection methods. Have fallback indexers that don't require Cloudflare bypass.
7. **Byparr is not a guaranteed fix (v5):** Helpful as a second solver to test, but not reliably better than FlareSolverr on every tracker.
8. **Gluetun port forwarding log noise:** UP_COMMAND logs `ERROR` on success because wget exit code is 1 for empty response bodies. Functional behavior is correct — ignore the error label.
9. **G-DRIVE USB port selection:** Always use the SuperSpeed port, not Thunderbolt. See Hardware Notes above.
10. **Sandy Bridge OpenVPN performance:** Unusable (~300 KB/s). Always use WireGuard on this hardware.
11. **Seerr permissions:** Container runs as UID 1000. Config dir must be owned by 1000:1000 or the container fails with "permission denied" on startup.
12. **AdGuard volume mount (v4):** Must be `/opt/adguardhome/conf`, NOT `/opt/adguardhome/confdir`. A mismatch causes config to be stored in the container's ephemeral filesystem, which is destroyed on container recreation. Always verify volume mount container paths match what the application expects.
13. **AdGuard client attribution (v5):** Bridge-mode Docker networking masked clients as `172.18.0.1`. Host networking fixed that and made persistent clients keyed to Tailscale IPs work properly.
14. **AdGuard + exit node loop (v5):** If Nucleus has Tailscale DNS enabled (`accept-dns=true`), exit-node client DNS can loop back through AdGuard and break the ad-blocking toggle design. Keep `sudo tailscale set --accept-dns=false` on Nucleus.
15. **AdGuard reverse proxy target (v5):** Because AdGuard runs in host networking mode, Caddy must proxy to `host.docker.internal:3000`, not `adguard:3000`. Requires `extra_hosts: ["host.docker.internal:host-gateway"]` on the Caddy service.
16. **Services bound to 0.0.0.0:** Most Docker services listen on every network interface, not just Tailscale. Anyone on the home LAN can reach services directly by IP + port. Some services (Radarr, Sonarr, Prowlarr) may have no authentication. Firewall setup is a priority to restrict access to Tailscale interface and localhost only.
17. **Debian installer partition alignment (v6):** The Debian netinst auto-partitioner may create partitions starting at sector 2 (especially on USB-connected drives), leaving no room for GRUB2 embedding. Always verify first partition starts at sector 2048 after install, or repartition if needed.
18. **Unmounted media drive can silently poison the stack (v6):** If `/mnt/media` is not mounted and Docker services start anyway, downloads may be written to the boot SSD under the empty mountpoint directory. Always verify `findmnt /mnt/media` before starting qBittorrent/Radarr/Sonarr/Jellyfin.
19. **qBittorrent category directories must exist (v6):** If `/media/downloads/radarr` or `/media/downloads/sonarr` are missing inside the shared mount, Radarr/Sonarr will warn that qBittorrent's reported download path does not exist even when the overall mount is correct.
20. **Bundled ffprobe path in Radarr (v6):** `ffprobe` may not be on `$PATH` inside the container. Use `/app/radarr/bin/ffprobe` when testing import/readability issues from inside the Radarr container.
---

## Key Commands Reference

```bash
# Docker basics
cp -a docker-compose.yml docker-compose.yml.backup-$(date +%F-%H%M%S)  # Timestamped compose backup
docker compose config > docker-compose.resolved-backup-$(date +%F-%H%M%S).yml  # Resolved config snapshot
docker compose up -d              # Start all services in background
docker compose down                # Stop all services
docker compose up -d servicename   # Start/recreate one service
docker compose restart servicename # Restart one service
docker compose logs -f             # Follow all logs
docker compose logs servicename    # Logs for one service
docker compose logs servicename --tail 30  # Last 30 lines
docker compose pull                # Pull updated images
docker compose up -d --force-recreate  # Restart with new images
docker ps                          # List running containers

# Troubleshooting
docker exec containername command  # Run command inside container
docker logs containername 2>&1 | grep "search term"  # Search logs

# Caddy
docker exec caddy caddy reload --config /etc/caddy/Caddyfile  # Reload config without restart
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile  # Validate Caddyfile inside container

# Tailscale
tailscale status                   # Show connected devices
sudo tailscale dns status          # Show local Tailscale DNS state
tailscale set --accept-dns=false   # Disable Tailscale-provided DNS on this device
tailscale set --accept-dns=true    # Re-enable Tailscale-provided DNS on this device
ssh allen@nucleus                  # SSH to server via MagicDNS short name
ssh allen@nucleus.tail35f3f2.ts.net  # FQDN fallback if short name fails

# VPN verification
docker exec gluetun wget -qO- https://ipinfo.io  # Check VPN public IP
docker exec radarr wget -qO- https://ipinfo.io   # Check non-VPN public IP (should differ)

# VPN speed test
docker exec gluetun time wget -qO /dev/null https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.4.0-amd64-netinst.iso

# Port forwarding check
docker exec gluetun cat /tmp/gluetun/forwarded_port

# Drive/storage
df -h /mnt/media                   # Check media drive space
df -h /srv                         # Check boot SSD space
lsblk -f                          # List drives and filesystems
sudo blkid /dev/sdb2              # Get UUID for fstab
findmnt /mnt/media                # Verify media HDD is actually mounted before starting stack



# Volume mount audit
for c in adguard jellyfin gluetun qbittorrent prowlarr radarr sonarr seerr flaresolverr caddy; do
  echo "=== $c ==="
  docker inspect "$c" --format '{{range .Mounts}}{{.Destination}} -> {{.Source}}{{"\n"}}{{end}}' 2>/dev/null
  echo ""
done

# Backup (example rsync cron — not yet configured)
# 0 3 * * * rsync -av --delete /srv/vault/ /mnt/backup/vault/
# 0 3 * * * rsync -av --delete /srv/appdata/vaultwarden/ /mnt/backup/vaultwarden/
```

---

## Roadmap — Not Yet Done

### Immediate (Next Session)
- [ ] **Firewall** — restrict services to Tailscale interface and localhost only (currently all services are exposed on LAN via 0.0.0.0)
- [ ] **Finalize JellyBridge cleanup** — after the short rollback window, delete the old live `/srv/appdata/jellybridge` directory if everything still looks stable
- [ ] **SSH key auth** — then disable password login
- [ ] Set static IP or DHCP reservation on router
- [ ] Harden media-drive auto-mount (`/etc/fstab` + consider `x-systemd.automount`) so the stack cannot write shadow files to the SSD after boot
- [ ] Add a small startup wrapper / checklist: verify `findmnt /mnt/media` before `docker compose up -d`
- [ ] Add more **working** indexers in Prowlarr (favor reliable mirrors over sheer count)
- [ ] Decide whether to keep Byparr long-term after more side-by-side testing

### Near-Term
- [ ] CouchDB + Obsidian LiveSync setup
- [ ] Vaultwarden setup
- [ ] Git-based vault version history (hourly auto-commit via cron)
- [ ] Nightly rsync backup: primary 10TB → backup 10TB (connect backup drive first)
- [ ] Back up `docker-compose.yml` and service configs
- [ ] Unattended security updates (`unattended-upgrades`)
- [ ] Configure qBittorrent seeding rules more granularly if current settings aren't behaving as expected
- [ ] **HTTPS for reverse proxy** — either cheap real domain or Caddy internal CA
- [ ] **Tailscale search domain** — add `nucleus` so bare hostnames like `jellyfin` resolve without the `.nucleus` suffix

### Future Enhancements
- [ ] **Infuse Pro** — premium Jellyfin client for macOS/iOS (~$15/year or ~$75 lifetime). Evaluate if Swiftfin quality becomes a friction point. Excellent H.265 direct-play eliminates server transcoding.
- [ ] **Streamyfin** — free iOS Jellyfin client with native Seerr integration (browse + request + play in one app). Companion server plugin available.
- [ ] **Upgrade AdGuard Home → Technitium DNS** — full authoritative/recursive DNS server with split-horizon support (returns different IPs based on whether request comes from LAN or Tailscale). Not needed now but useful if the setup grows in complexity.
- [ ] **Add Bazarr** — subtitle management, automatic download for Radarr/Sonarr libraries
- [ ] **Add Lidarr** — music management (same pattern as Radarr/Sonarr)
- [ ] **Enable Jellyfin trickplay image extraction** — thumbnail previews when scrubbing video timeline. CPU-intensive on Sandy Bridge; enable during off-peak and let it run overnight.
- [ ] **Enable Jellyfin chapter image extraction** — same caveat as trickplay.
- [ ] **Tailscale Mullvad addon** — device-level VPN for phone/laptop that coexists with tailnet access. Evaluate when Proton subscription expires.
- [ ] **Samba/SMB** for general file access from desktop (if still wanted)
- [ ] **Uptime Kuma** — service monitoring dashboard (optional)
- [ ] **RAM upgrade** — 8GB DDR3 SO-DIMM to reach ~12GB (budget ~$15-20). Not urgent but will help as more containers are added.

### Broader Project
- [ ] Writerdeck build (2008 MacBook + e-ink display)
- [ ] Custom ortholinear keyboard (Preonic/ID75 form factor, typewriter keys, 3D printed enclosure)

---

## Parts Status

| Part | Status | Notes |
|---|---|---|
| Lenovo 65W/90W charger | ✅ Arrived | Working |
| m.2-to-mSATA adapter | ✅ Installed (v6) | Boot drive now internal |
| 1x8GB DDR3 SO-DIMM | ❌ Not ordered | ~$15-20 |
| 5-6 bay USB 3.0 enclosure | ❌ Not ordered | ~$50-70 |
| ExpressCard USB 3.0 adapter | ❌ Not ordered | ~$10-15 |
| USB-C to USB-A adapter | ❌ Not ordered | ~$5 (for backup drive) |

---

## Software Stack Summary

| Service | Purpose | Port | Friendly URL | Status |
|---|---|---|---|---|
| Debian 13 Trixie | Host OS | — | — | ✅ Running |
| Docker + Docker Compose | Container runtime | — | — | ✅ Running |
| Tailscale | Mesh VPN / remote access | — | — | ✅ Running |
| Caddy | Reverse proxy | 80 | — | ✅ Running |
| AdGuard Home | DNS + ad blocking | 53, 3000 | `adguard.nucleus` | ✅ Running |
| Gluetun + ProtonVPN | Torrent VPN (WireGuard) | — | — | ✅ Running |
| Jellyfin | Media server / streaming | 8096 | `jellyfin.nucleus` | ✅ Running |
| Prowlarr | Indexer manager | 9696 | `prowlarr.nucleus` | ✅ Running |
| Radarr | Movie management | 7878 | `radarr.nucleus` | ✅ Running |
| Sonarr | TV show management | 8989 | `sonarr.nucleus` | ✅ Running |
| qBittorrent | Torrent client (via Gluetun) | 8080 | `qbit.nucleus` | ✅ Running |
| Seerr | Media request UI | 5055 | `seerr.nucleus` | ✅ Running |
| FlareSolverr | Cloudflare bypass | 8191 | — | ✅ Running |
| Byparr | Alt. Cloudflare bypass | 8192 (host) / 8191 (internal) | — | ✅ Running |
| CouchDB | Obsidian LiveSync | 5984 | — | ❌ Not started |
| Vaultwarden | Password manager | 8443 | — | ❌ Not started |
| Samba | SMB file shares | 445 | — | ❌ Not started |

Monthly cost: $0 currently (Proton VPN already paid). When Proton expires, ~$5/month for Mullvad or Proton renewal.

---

## Key Principles & Decisions

- **Debian 13 over 12:** Newer frozen package baseline (kernel 6.12 LTS, Python 3.13, GCC 14.2). Since Debian Stable locks versions at install, starting with the newest stable release gives better packages for the entire support lifecycle (through 2030).
- **Debian over Ubuntu Server:** Stability policy, conservative kernel suitable for Sandy Bridge, genuinely minimal install, no snap/Canonical tooling.
- **WireGuard over OpenVPN:** 36x faster on Sandy Bridge. Non-negotiable on this hardware.
- **Gluetun over Tailscale Mullvad addon for torrents:** Surgical — only routes qBittorrent through VPN. Everything else uses the regular internet. Tailscale Mullvad addon is for device-level VPN on phones/laptops (complementary, not competing).
- **ext4 over HFS+:** Linux's HFS+ write support is fragile and not suitable for a production media server. Reformatted the 10TB drive to ext4.
- **Unfiltered Quad9 for DNS upstream:** Avoids false positives from filtered DNS blocking torrent-related domains.
- **`/srv` for SSD data, `/mnt` for external drives:** Follows Linux filesystem hierarchy conventions cleanly.
- **Shared volume mounts for media containers (v4):** All containers that touch media files mount `/mnt/media:/media` — same host path, same container path. Enables hardlinks (zero-copy imports) and eliminates path mismatch bugs.
- **Caddy for reverse proxy (v4):** Simplest config (two lines per service), readable prose syntax, sensible defaults. Chosen over Nginx (verbose boilerplate) and Traefik (steep learning curve, auto-discovery complexity unnecessary for a stable service set).
- **Dual DNS path (v4):** Docker containers query Quad9 directly (immune to ad-blocking false positives), end-user devices query AdGuard via Tailscale (ad-blocking active). Clean separation of concerns.
- **Ad-blocking toggle via exit node (v4/v5):** Tailscale's split DNS + global nameserver configuration allows toggling ad-blocking per device with a single tap in the Tailscale app (activate exit node = ad-blocking off, deactivate = on). `.nucleus` resolution is preserved in all states, and Nucleus itself keeps `accept-dns=false` so exit-node DNS does not loop back through AdGuard.
- **AdGuard on host networking (v5):** Chosen so AdGuard sees real client Tailscale IPs instead of Docker bridge addresses. This makes persistent client mappings actually useful.
- **Long-term DNS preference (v5):** Prefer the convenient exit-node ad-block toggle over perfect per-device attribution for every possible DNS path. Direct and split-DNS traffic is attributed cleanly; general exit-node DNS is intentionally allowed to bypass AdGuard.
- **Partition alignment matters (v6):** First partition must start at sector 2048 on MBR disks for GRUB2 to embed properly. The Debian installer doesn't always guarantee this, especially on USB-connected drives. Verify after install and repartition if needed.
