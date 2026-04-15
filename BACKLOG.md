# DAMP Project Backlog

## Done
- [x] **Core isolation:** Engine moved to `core/`, separated from projects.
- [x] **Global registry:** Persistence in `~/.damp/projects.json`.
- [x] **UI/UX:** "Terminal-Luxe" interface with sidebar and Bento layout.
- [x] **Zero-config adoption:** Native folder picker and auto Caddy/DNS config.
- [x] **SSL/DNS:** `trust` and `setup-dns` scripts working.
- [x] **Dashboard:** Web UI with project creation, database management (MySQL + PostgreSQL), Redis status, logs, EN/ES support.
- [x] **CLI:** `damp new` with interactive template selector and auto-setup (DB + Caddy + hosts + containers).
- [x] **CLI:** `damp init` for existing projects (auto-detect template, backup conflicts, in-place setup).
- [x] **TLD:** Switched default to `.test` (RFC 6761), `/etc/hosts` as primary DNS, `damp-dns` optional via profile.
- [x] **Dashboard:** Auto-detect template on folder selection, `/etc/hosts` entry on project creation.
- [x] **Global command:** `damp` available system-wide via `/usr/local/bin`.

## Priority
- [ ] **Interactive `damp init`:** Prompt for project name, TLD (.test/.dev/.example), and database name with smart defaults.
- [ ] **Custom TLD per project:** Allow users to choose TLD during init/new instead of only global `DAMP_TLD`.
- [ ] **Data persistence:** Move `mysql_data`/`postgres_data`/`caddy_data` to bind-mounts (`./data/`) to survive `docker compose down -v`.
- [ ] **Backup/Restore:** `./damp backup` / `./damp restore` — automated DB dumps to `./data/backups/YYYY-MM-DD/`.
- [ ] **Port conflict detection:** Alert when ports are already in use before starting the engine.
- [ ] **Real-time logs in Desktop App:** Integrate log viewer into Tauri app.

## Future
- [ ] **Modular services:** Enable/disable services (`damp enable memcached`), version swapping (`damp use mysql 5.7`).
- [ ] **Bundling:** Include `core/` inside Tauri app resources.
- [ ] **Pro templates:** Add Laravel, Astro, and optimized WordPress templates.
- [ ] **Multi-platform:** Test installers on Windows (WSL2) and Linux.
