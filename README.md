<p align="center">
  <img src="docs/icon-192.png" alt="DAMP" width="120">
</p>

<h1 align="center">DAMP</h1>

<p align="center"><strong>Dockerized Auto-SSL Modern Platform</strong></p>

<p align="center"><a href="https://sistematlan.github.io/damp/">Project site (GitHub Pages)</a></p>

<p align="center">
A modern, open-source replacement for MAMP, XAMPP, WAMP, and LAMP.<br>
One command to get a full local development environment with HTTPS, databases, email testing, and project templates.
</p>

> **Platform support:** macOS fully supported. Linux and Windows WSL2 support added (testing welcome).

## What you get

- **Caddy** — Reverse proxy with automatic HTTPS for `*.local` domains
- **MySQL 8.4 & PostgreSQL 16** — Shared database servers
- **Redis 7** — Local cache and session storage
- **PHPMyAdmin** — Database management UI
- **Mailpit** — Catch-all SMTP for development email testing
- **Web Dashboard** — Visual project management at `https://damp.local`
- **Project templates** — Start new projects in seconds (WordPress, PHP 8.4, 7.4, 5.6, Node.js)
- **Desktop app** — Native macOS app with System Tray (experimental)

## Requirements

- **macOS 12+** — [OrbStack](https://orbstack.dev) (recommended) or [Docker Desktop](https://docker.com)
- **Linux** — [Docker Engine](https://docs.docker.com/engine/install/)
- **Windows** — [Docker Desktop](https://docker.com) with WSL2 enabled

## Quick start

```bash
git clone https://github.com/sistematlan/damp.git
cd damp
./install.sh
```

The installer will:
1. Check for Docker (suggests OrbStack if not found)
2. Create configuration from template
3. Start all services
4. Wait for databases to be healthy
5. Install SSL certificate (HTTPS without browser warnings)
6. Configure DNS (all `*.local` domains resolve automatically)
7. Add `damp` command to your PATH

## Services

| Service     | HTTPS                  | HTTP                   | From containers    |
|-------------|------------------------|------------------------|--------------------|
| Dashboard   | https://damp.local     | http://localhost:9200  | —                  |
| PHPMyAdmin  | https://pma.local      | http://localhost:8080  | —                  |
| Mailpit     | https://mail.local     | http://localhost:8025  | damp-mailpit:1025  |
| MySQL       | —                      | localhost:3306         | damp-db:3306       |
| PostgreSQL  | —                      | localhost:5432         | damp-postgres:5432 |
| Redis       | —                      | localhost:6379         | damp-redis:6379    |

## CLI

After installation, `damp` is available globally from any directory.

```bash
damp help              # Show all commands

# Engine
damp up                # Start DAMP
damp down              # Stop DAMP
damp restart           # Restart DAMP
damp status            # Show service status
damp update            # Pull latest version and rebuild

# Projects
damp new my-project              # Create project (interactive template selector)
damp new frankenphp my-project   # Create with specific template
damp start my-project            # Start a project's containers
damp stop my-project             # Stop a project's containers
damp list                        # List all registered projects
damp exec my-project             # Shell into project container

# Database
damp databases         # List databases
damp create-db mydb    # Create a database
damp drop-db mydb      # Drop a database
damp import mydb dump.sql  # Import SQL dump
damp export mydb           # Export SQL dump

# SSL & DNS
damp trust             # Install CA in system keychain
damp setup-dns         # Configure auto-DNS for *.local (macOS)
damp reload            # Reload Caddy after config changes
```

## Create a project

### From CLI (recommended)

```bash
damp new frankenphp my-project
```

That's it. DAMP will:
1. Copy the template files
2. Create a MySQL database (`my_project_db`)
3. Generate Caddy HTTPS config
4. Add the domain to `/etc/hosts`
5. Start the containers

Your project is live at `https://my-project.local`.

### From the Dashboard

Open `https://damp.local` and go to **Projects**:

- **New Project** — Creates database and Caddy config. Run `damp new` to scaffold files.
- **Add Existing Folder** — Browse your filesystem, select a folder. DAMP copies the template if needed, creates DB + Caddy config, and starts the containers automatically.

Each project has **play/stop/restart/delete** controls directly in the dashboard.

## Templates

| Template      | Stack                    | Use case                              |
|---------------|--------------------------|---------------------------------------|
| `frankenphp`  | PHP 8.4 + FrankenPHP     | CodeIgniter 4, Laravel 11+, Symfony 7 |
| `php-fpm`     | PHP 8.4 + Nginx + FPM   | CI4, Laravel, WordPress, Symfony      |
| `php-legacy`  | PHP 7.4 + Nginx + FPM   | CodeIgniter 3, Laravel 8              |
| `php-ancient` | PHP 5.6 + Apache         | Legacy rescue                         |
| `wordpress`   | WordPress + MySQL        | Blogs, CMS                            |
| `node`        | Node.js 22               | React, Vue, Astro, Next.js, Express   |

## Web Dashboard

The dashboard runs at `https://damp.local` (or `http://localhost:9200`) and provides:

- **Overview** — All 8 services with status, ports, and quick access links. Engine start/stop controls.
- **Projects** — Create, import, start/stop/restart/delete projects. Built-in folder browser.
- **Databases** — MySQL and PostgreSQL management (create/drop). Redis status and memory info.
- **Logs** — Real-time container log streaming.
- **Bilingual** — English and Spanish (toggle in sidebar).

## Database access

**From your Mac:**
```
MySQL:      localhost:3306  (root/root)
PostgreSQL: localhost:5432  (root/root)
Redis:      localhost:6379
```

**From containers:**
```
MySQL:      damp-db:3306       (root/root)
PostgreSQL: damp-postgres:5432 (root/root)
Redis:      damp-redis:6379
```

## Email testing

Configure your app to use Mailpit as SMTP:

```
Host: damp-mailpit (from containers) / localhost (from Mac)
Port: 1025
Auth: none
TLS: none
```

All emails are captured at https://mail.local

## Updating

```bash
damp update
```

This pulls the latest code and rebuilds all services.

## Platform support

| Platform | Status |
|----------|--------|
| macOS 12+ (Apple Silicon & Intel) | **Fully supported** |
| Linux (Ubuntu, Fedora, Debian) | **Supported** (testing welcome) |
| Windows (WSL2) | **Supported** (testing welcome) |

## License

MIT — see [LICENSE](LICENSE).
