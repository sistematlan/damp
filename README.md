<p align="center">
  <img src="core/dashboard/web/img/mascota.png" alt="DAMP" width="120">
</p>

<h1 align="center">DAMP</h1>

<p align="center"><strong>Dockerized Auto-SSL Modern Platform</strong></p>

<p align="center"><a href="https://sistematlan.github.io/damp/">Project site</a></p>

<p align="center">
A modern, open-source replacement for MAMP, XAMPP, WAMP, and LAMP.<br>
One command to get a full local development environment with HTTPS, databases, email testing, and project templates.
</p>

> **Platform support:** macOS fully supported. Linux and Windows WSL2 support added (testing welcome).

---

## What you get

| Service       | URL                              | From containers         |
|---------------|----------------------------------|-------------------------|
| **Dashboard** | https://damp.test                | —                       |
| **PHPMyAdmin**| https://pma.test                 | —                       |
| **Mailpit**   | https://mail.test                | damp-mailpit:1025       |
| **MySQL 8.4** | localhost:3306                   | damp-db:3306            |
| **PostgreSQL 16** | localhost:5432              | damp-postgres:5432      |
| **Redis 7**   | localhost:6379                   | damp-redis:6379         |
| **Caddy**     | Automatic HTTPS for all projects | —                       |

Default credentials: `root` / `root` for MySQL and PostgreSQL.

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
6. Add `damp` command to your PATH

After installation, open https://damp.test in your browser.

---

## Working with projects

DAMP gives you two ways to set up projects: **CLI** and **Dashboard**. Both do the same thing — create a database, generate HTTPS config, add a DNS entry, and start containers.

### New project from scratch

```bash
# Interactive — detects or asks for template
damp new my-project

# Explicit template
damp new frankenphp my-project
```

This creates a new directory `my-project/` with the template files, a database (`my_project_db`), and starts it at `https://my-project.test`.

### Existing project (import)

```bash
cd ~/projects/my-existing-app
damp init my-app
```

`damp init` works from inside your project directory:
1. **Detects** the project type (CI4, Laravel, Symfony, Node, WordPress, etc.)
2. **Copies** the template files (`docker-compose.yml`, `Dockerfile`, `Caddyfile`) — backs up any existing files as `.bak`
3. **Creates** a database (`my_app_db`)
4. **Adds** `my-app.test` to `/etc/hosts` and Caddy
5. **Starts** the containers

If you omit the name, it uses the folder name: `damp init` in `~/projects/my-app/` → `my-app.test`.

### From the Dashboard

Open https://damp.test → **Projects**:

- **New Project** — Enter a name and select a template. Creates the database and Caddy config. Run `damp new <name>` to scaffold the files.
- **Add Existing Folder** — Browse your filesystem, select a folder. DAMP auto-detects the template, copies files if needed, creates DB + Caddy config, adds `/etc/hosts` entry, and starts the containers.

Each project has **play/stop/restart/delete** controls in the dashboard.

---

## Templates

| Template      | Stack                    | Use case                              |
|---------------|--------------------------|---------------------------------------|
| `frankenphp`  | PHP 8.4 + FrankenPHP     | CodeIgniter 4, Laravel 11+, Symfony 7 |
| `php-fpm`     | PHP 8.4 + Nginx + FPM   | Classic PHP apps                      |
| `php-legacy`  | PHP 7.4 + Nginx + FPM   | CodeIgniter 3, Laravel 8              |
| `php-ancient` | PHP 5.6 + Apache         | Legacy rescue                         |
| `wordpress`   | WordPress + MySQL        | Blogs, CMS                            |
| `node`        | Node.js 22               | React, Vue, Astro, Next.js, Express   |

## CLI reference

```bash
damp help              # Show all commands

# Engine
damp up                # Start DAMP
damp down              # Stop DAMP
damp restart           # Restart DAMP
damp status            # Show service status
damp update            # Pull latest version and rebuild

# Projects
damp new my-project              # Create project (interactive)
damp new frankenphp my-project   # Create with specific template
damp init [name]                 # Init existing project (run from project dir)
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
damp trust             # Install Caddy CA in system keychain (HTTPS without warnings)
damp setup-dns         # Configure wildcard DNS (optional, see DNS section)
damp reload            # Reload Caddy after config changes
damp add-host domain   # Add a domain to /etc/hosts
```

---

## DNS and domain resolution

DAMP uses the `.test` TLD by default. Each project gets a domain like `my-project.test`.

### How it works

When you create or init a project, DAMP automatically adds `127.0.0.1 my-project.test` to `/etc/hosts`. This works on all platforms and with all Docker runtimes (OrbStack, Docker Desktop, Colima).

### Why .test instead of .local?

- `.local` is reserved for **mDNS/Bonjour** on macOS, which causes DNS conflicts and slow resolution
- `.test` is reserved by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761) specifically for testing — no conflicts, no external resolution
- `.test` works cleanly with `/etc/hosts` and custom DNS resolvers

### Custom TLD

You can change the TLD in `core/.env`:

```env
DAMP_TLD=dev    # or .example, .localhost, etc.
```

After changing, run `damp reload` to apply.

### Optional: Wildcard DNS

If you need wildcard subdomains (e.g., `*.my-project.test`) or don't want `/etc/hosts` entries, you can enable the built-in DNS resolver:

```bash
# Start DAMP with the DNS service
docker compose --profile dns up -d

# Configure macOS to use it
damp setup-dns
```

> **Note:** This requires port 53 to be available. OrbStack and some Docker runtimes use port 53 for their own DNS, which will conflict. In that case, stick with `/etc/hosts` (the default).

---

## HTTPS and SSL certificates

DAMP uses Caddy's internal CA to issue certificates for all `*.test` domains automatically. No external CA, no Let's Encrypt — everything is local.

### First-time setup

After starting DAMP for the first time, run:

```bash
damp trust
```

This installs Caddy's root CA in your system keychain so browsers trust the certificates without warnings. You only need to do this once (or after Caddy regenerates its CA).

### Certificate errors?

If you see certificate warnings in the browser:
1. Run `damp trust` again
2. Restart your browser
3. If using Chrome, try clearing the HSTS cache: `chrome://net-internals/#hsts`

---

## Email testing

Configure your app to use Mailpit as SMTP:

```
Host: damp-mailpit (from containers) / localhost (from Mac)
Port: 1025
Auth: none
TLS: none
```

All emails are captured at https://mail.test — nothing is sent externally.

## Dashboard

The web dashboard at https://damp.test provides:

- **Overview** — Service status, ports, quick access links, engine start/stop
- **Projects** — Create, import, start/stop/restart/delete projects with a folder browser
- **Databases** — MySQL and PostgreSQL management (create/drop), Redis status
- **Logs** — Real-time container log streaming
- **Bilingual** — English and Spanish (toggle in sidebar)

## Updating

```bash
damp update
damp reload
```

`damp update` pulls the latest code and rebuilds all services. Always run `damp reload` after updating to apply any Caddy configuration changes.

If a new version changes the default TLD or templates, you may also need to run `damp trust` again to update SSL certificates.

## Platform notes

| Platform | Status | Notes |
|----------|--------|-------|
| macOS 12+ (Apple Silicon & Intel) | **Fully supported** | OrbStack recommended |
| Linux (Ubuntu, Fedora, Debian) | **Supported** | Testing welcome |
| Windows (WSL2) | **Supported** | Testing welcome |

## License

MIT — see [LICENSE](LICENSE).
