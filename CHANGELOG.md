# Changelog

All notable changes to DAMP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While DAMP is on `0.x`, breaking changes may land in minor releases. Starting
at `1.0.0`, breaking changes will be reserved for major bumps.

## [Unreleased]

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

[Unreleased]: https://github.com/sistematlan/damp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sistematlan/damp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sistematlan/damp/releases/tag/v0.1.0
