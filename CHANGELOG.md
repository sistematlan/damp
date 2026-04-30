# Changelog

All notable changes to DAMP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While DAMP is on `0.x`, breaking changes may land in minor releases. Starting
at `1.0.0`, breaking changes will be reserved for major bumps.

## [Unreleased]

## [0.6.1] — 2026-04-30

### Fixed
- **`damp init` 502 Bad Gateway**: resolved multiple Docker Compose naming and DNS issues.
  - Removed invalid `--no-prefix` flag (does not exist in Docker Compose).
  - Added `name:` at the top-level of all generated `docker-compose.yml` files so Docker Compose respects the project name.
  - Added `hostname:` to app/web services for robust DNS resolution inside the `damp` network.
  - Auto-removes residual `compose.yaml` (Laravel 11+ default) which Docker Compose prioritizes over our `docker-compose.yml`.
  - Fixed `node` template incorrectly using `build: .` instead of `image: node:22-alpine`.
- **`damp trust` hardcoded TLD**: `trust-cert.sh` now dynamically uses `$DAMP_TLD` (default `.test`) instead of hardcoding `*.local`.

## [0.6.0] — 2026-04-29

### Added
- **Architectural Unification (Desktop ↔ Go Backend)**:
  - Tauri app now acts as a client for the Go HTTP API (`localhost:9000`).
  - Multi-platform Go dashboard binaries bundled as sidecars (Windows, macOS Intel/M1, Linux).
  - Native database backups on project deletion via Go backend logic.
- **Real-time Streaming Logs**:
  - Migrated `Logs.tsx` to Server-Sent Events (SSE).
  - Instant log streaming from Docker containers via Go backend.
- **UI/UX Enhancements**:
  - **Template Gallery**: Replaced simple selects with descriptive cards for project templates.
  - **Project Adoption Preview**: Shows detected files and path before importing folders.
  - **Service Grid**: Added `damp-dashboard` status to the Overview dashboard.

### Changed
- Replaced Rust-native Docker/Caddy logic in Tauri with HTTP API calls to the Go sidecar.
- Increased default window size for better dashboard visibility.

## [0.5.0] — 2026-04-27

### Added
- **Interactive `damp init` with Dampfile generation**: complete rewrite of the init command.
  - Prompts for project name, type (auto-detected), PHP version, document root, database name.
  - Generates `Dampfile`, `docker-compose.yml`, and type-specific files (Dockerfile, nginx.conf, Caddyfile) on the fly.
  - No more template file copying or `.bak` backups.
- **Node.js first-class support**:
  - `detect_node_port()`: auto-detects dev server port from `package.json` (Vite 5173, Next.js/Nuxt/CRA 3000, Angular 4200, Astro 4321).
  - `detect_node_command()`: picks the correct dev command per framework.
  - `patch_vite_config()`: automatically patches `vite.config.js` with `host: '0.0.0.0'` and `allowedHosts: true` for Caddy reverse-proxy compatibility.
  - `patch_vite_proxy()`: detects proxy targets using `.test`/`.local`/`.dev` domains and replaces them with Docker container names (e.g., `https://api.test` → `http://api-app:80`).
- **Optional database creation**: `damp init` now asks "Create database?" — defaults to No for Node.js, Yes for PHP projects.
- **Desktop app (Tauri) Windows support**:
  - `get_docker_path()`: detects `docker.exe` on Windows.
  - `is_docker_desktop_installed()`: cross-platform check (Docker Desktop, OrbStack, Linux).
  - Native project creation in Rust without bash dependency.

### Changed
- **WordPress template**: project directory is now fully mounted (`./:/var/www/html`) instead of only `./wp-content`, allowing direct file editing.
- `setup_project()`: accepts a `proxy_port` parameter so Node.js containers proxy to the correct dev server port instead of hardcoded `:80`.
- Caddy config generation now uses the detected port (e.g., `reverse_proxy app:5173` for Vite).

### Fixed
- **Node.js 502 Bad Gateway**: Caddy now proxies to the correct dev server port instead of `:80`.
- **Vite 403 Forbidden**: `allowedHosts: true` is automatically added to `vite.config.js`.
- **bash `local` error**: removed `local` declarations from `case` blocks in `damp init`.

## [0.4.0] — 2026-04-24

### Added
- **Dampfile**: declarative YAML configuration standard for projects. Replaces manual Dockerfile/docker-compose.yml setup with a single `Dampfile` per project.
- **`damp init` interactive mode**: auto-detects project type (CI4, Laravel, Node, etc.), PHP version from composer.json, document root, and suggests database name.
- **`damp exec` command**: execute CLI commands inside project containers (spark, artisan, composer) without host PHP installation.
- **`damp-compose` wrapper**: context-aware docker-compose that reads Dampfile configuration.
- Dashboard: premium dark UI redesign with animations, glow effects, and micro-interactions.
- Dashboard: tabbed navigation (Services / Projects).
- Dashboard: project cards with icons, metadata, and status indicators.
- Dashboard: async project import with background container startup (no more hanging).
- Dashboard: stagger animations and hover effects throughout.

### Changed
- **Project import flow**: now generates `Dampfile` instead of copying template files. No more `.bak` files or manual Dockerfile edits.
- Dashboard: updated to `.test` TLD across all service links.
- Dashboard: service grid now uses `grid-template-columns: repeat(auto-fill, ...)` for responsive layout.
- Backend: Docker compose up runs asynchronously to prevent HTTP timeouts during project creation.

### Fixed
- Dashboard JavaScript syntax error in `engineAction()` calls.
- Missing axolotl mascot icon in sidebar.
- Project creation timeout — containers now start in background goroutine.

### Deprecated
- Template-based project creation (legacy `damp new <template> <name>` still works but Dampfile is preferred).

## [0.3.1] — 2026-04-24

### Added
- `setup-dns.sh`: comprehensive host-native DNS installer for macOS
  (Homebrew), Linux (apt/dnf/pacman), and WSL2. Installs dnsmasq,
  configures wildcard `*.test` → `127.0.0.1`, no Docker dependency.
- macOS: osascript password dialog during `install.sh` and
  `damp setup-dns` so the user gets a clear system-level prompt
  instead of a blinking terminal.
- Dashboard: `reloadCaddy()` function uses Caddy's admin API
  (`POST http://damp-caddy:2019/load`) to reload config dynamically
  without recreating the container. Works across all Docker runtimes.
- Caddyfile: `admin 0.0.0.0:2019` exposes the admin API to the
  Docker network so the dashboard can reach it.
- `install.sh` step 6 now calls `setup-dns.sh` (was broken — used
  stale `DAMP_TLD:-local` references and never installed dnsmasq).

### Changed
- **DNS: host-native dnsmasq replaces all other approaches.** The
  `damp-dns` container has been removed from `docker-compose.yml`.
  Previous approaches (`/etc/hosts` from the container, Docker-based
  dnsmasq) were unreliable on macOS/OrbStack because Docker
  bind-mounts of `/etc/hosts` don't sync writes back to the host,
  and UDP port forwarding from containers is fragile.
- **Dashboard project creation no longer writes `/etc/hosts`.** DNS
  is handled entirely by the host-level dnsmasq installed at setup.
  The `addHostEntry()` function is kept as a best-effort fallback
  (it works on Linux where the bind mount is writable).
- `damp reload` (dashboard): now uses Caddy admin API internally
  instead of `docker compose up -d caddy --force-recreate`.

### Fixed
- Projects imported via the dashboard not resolving in the browser
  (ERR_NAME_NOT_RESOLVED) — root cause: `/etc/hosts` bind-mount on
  macOS/OrbStack doesn't propagate writes from the container to the
  host.
- `install.sh` step 6 referencing `DAMP_TLD:-local` (should be
  `:-test`) and never installing dnsmasq.
- Caddy not picking up new project configs after dashboard import —
  `docker compose up -d caddy --force-recreate` didn't work reliably
  from inside the dashboard container on macOS.

### Removed
- `damp-dns` service from `docker-compose.yml`. The dnsmasq-in-Docker
  approach was unreliable on macOS (UDP port forwarding broken) and
  Linux (`systemd-resolved` port 53 conflict).

## [0.3.0] — 2026-04-14

### Added
- `damp init [name]` command to integrate existing projects into DAMP
  without creating a subdirectory. Auto-detects project type, copies
  template files (backing up conflicts), and sets up DB, Caddy vhost,
  and containers.
- Dashboard: auto-detects project template when selecting a folder
  via the `GET /api/detect-template?path=...` endpoint.
- Dashboard: adds `/etc/hosts` entry automatically on project creation.
- Dashboard: backs up existing files (`.bak`) before copying template.
- `damp start/stop <project>` commands for individual project control.
- `damp update` command (git pull + rebuild).
- `damp list` command to show registered projects and their status.
- Linux and Windows WSL2 support (folder browser shows `/home` and
  `/mnt` on WSL2).
- Dashboard: folder browser, auto-start, project name normalization,
  start/stop/restart/delete controls, project registry, services grid.
- GitHub Pages project site.

### Changed
- **Default TLD changed from `.local` to `.test`** — `.test` is reserved
  by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761) for testing and
  does not conflict with macOS mDNS/Bonjour. Configurable via `DAMP_TLD`.
- **DNS: `/etc/hosts` is now the primary mechanism** — entries are added
  automatically by both CLI and dashboard. Works with all Docker runtimes
  (OrbStack, Docker Desktop, Colima).
- **`damp-dns` disabled by default** — moved to Docker Compose profile
  `dns`. Enable with `docker compose --profile dns up -d` when wildcard
  DNS is needed (e.g., Linux without mDNS conflicts).
- Caddy uses `local_certs` (internal CA) for all domains instead of
  attempting ACME with Let's Encrypt/ZeroSSL.
- README completely rewritten with comprehensive documentation for CLI,
  dashboard, DNS, SSL, project workflows, and platform notes.

### Fixed
- Dashboard project start/stop now works correctly.
- WSL2 folder browser now shows `/home` and `/mnt`.

### Breaking
- Default TLD is now `.test` instead of `.local`. Existing projects
  using `.local` domains will need their Caddy configs and `/etc/hosts`
  entries updated. Set `DAMP_TLD=local` in `core/.env` to keep the
  old behavior.
- `damp-dns` no longer starts by default. Use `--profile dns` or
  set `DAMP_TLD=local` and run `damp setup-dns` for wildcard DNS.

## [0.2.0] — 2026-04-11

### Added
- PostgreSQL 16 and Redis 7 as first-class services in the core stack.
- `damp-dns` (dnsmasq) container that wildcards `*.local` to `127.0.0.1`
  so new project subdomains resolve automatically.
- `core/bin/setup-dns.sh` helper to configure the macOS resolver against
  the `damp-dns` container.
- WordPress project template under `core/templates/wordpress`.
- `/api/projects` endpoint in the Go dashboard, backed by the global
  registry at `~/.damp/projects.json`.
- Desktop app: native system tray, folder picker via
  `tauri-plugin-dialog`, and the "Terminal-Luxe" sidebar + Bento layout.
- `BACKLOG.md` roadmap file at the repo root.

### Changed
- **Repository layout**: the entire engine (Docker compose, templates,
  dashboard, Caddy, MySQL init, helper scripts) now lives under `core/`.
  The top-level `./damp` entrypoint is preserved as a symlink to
  `core/bin/damp`.
- README rewritten to describe the new stack and project flow.
- `.gitignore` updated to match the new paths and to ignore dashboard
  build artifacts and the upcoming `data/` directory.

### Fixed
- Identified that named Docker volumes are lost on
  `docker compose down -v`. Data persistence via bind-mounts is
  tracked in `BACKLOG.md` as the next priority.

### Breaking
- Any external script that referenced `./docker-compose.yml`,
  `./install.sh`, `./trust-cert.sh`, `./templates/`, `./mysql/`, or
  `./caddy/` at the repository root must now use the `core/` prefix.
  The `./damp` CLI is unchanged.

## [0.1.0] — 2026-04-07

Initial internal release.

### Added
- Caddy reverse proxy with automatic HTTPS for `*.local`.
- MySQL 8.4 + PHPMyAdmin for database management.
- Mailpit as a catch-all SMTP server for development.
- Project templates: FrankenPHP, php-fpm, php-legacy (7.4),
  php-ancient (5.6), and Node.js 22.
- Go web dashboard with overview, databases, logs, and projects views.
- Tauri desktop app (macOS).
- `./damp` CLI: `up`, `down`, `status`, `logs`, `databases`,
  `create-db`, `drop-db`, `import`, `export`, `new`, `exec`, `trust`,
  `reload`, `add-host`.

[Unreleased]: https://github.com/sistematlan/damp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/sistematlan/damp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sistematlan/damp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sistematlan/damp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sistematlan/damp/releases/tag/v0.1.0
