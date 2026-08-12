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

### Runtime profiles and resource safety

DAMP 0.8 starts a deliberately small core by default: Caddy, MySQL, and the
dashboard. Optional dependencies are enabled only when needed:

```bash
damp up              # minimal core
damp up tools        # + PHPMyAdmin
damp up mail         # + Mailpit
damp up cache        # + Redis
damp up postgres     # + PostgreSQL
damp up full         # every service
```

Every managed container has RAM, swap, CPU, and PID budgets. A runaway runtime
is contained instead of forcing the host into swap thrashing. `damp stats` and
the dashboard's **Runtime health** panel show current consumption and flag
containers above 75% (warning) or 90% (critical) of their memory budget.

Defaults can be adjusted in `core/.env`. Generated projects also declare their
budget under `resources` in `Dampfile` and in `docker-compose.yml`. Prefer
raising a specific project's budget over removing the limits globally.

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
6. **Configure DNS** — installs dnsmasq natively on the host so all `*.test` domains resolve automatically (prompts for password on macOS via a system dialog)
7. Add `damp` command to your PATH

After installation, open https://damp.test in your browser.

### Fastest onboarding (3 minutes)

```bash
git clone https://github.com/sistematlan/damp.git
cd damp
./install.sh
```

1. Install and open `https://damp.test`.
2. If certificates are not yet trusted, run:
   ```bash
   damp trust
   ```
3. Create your first project:
   ```bash
   damp new frankenphp my-project
   ```
4. Open `https://my-project.test` in your browser.

For existing projects, initialize and adopt them in place:

```bash
cd ~/projects/my-existing-app
damp init
```

---

## Working with projects

DAMP gives you two ways to set up projects: **CLI** and **Dashboard**. Both create a database, generate HTTPS config, and start containers. DNS resolution is handled automatically by the dnsmasq service installed during setup.

### The Dampfile (recommended)

DAMP v2.0 introduces the **Dampfile** — a single YAML file that replaces manual Docker configuration:

```yaml
# Dampfile v1.0
version: "1.0"

project:
  name: my-project
  domain: my-project.test
  type: php-fpm  # php-fpm, frankenphp, node, static

runtime:
  php_version: "8.4"
  document_root: public

database:
  name: my_project_db
  create: true
```

Run `damp init` from your project directory and DAMP handles the rest:
- Generates `Dampfile` with your project's configuration
- Generates `docker-compose.yml` tailored to your stack
- Generates type-specific files (Dockerfile, nginx.conf, Caddyfile) only when needed
- No manual Caddy configuration
- No template files to copy

### Existing project (import)

```bash
cd ~/projects/my-existing-app
damp init
```

`damp init` works interactively from inside your project directory:
1. **Suggests** project name from folder name
2. **Detects** project type (CI4, Laravel, Symfony, Node, WordPress, etc.)
3. **Finds** document root (auto-discovers `index.php`)
4. **Suggests** database name
5. **Generates** `Dampfile` and `docker-compose.yml`
6. **Creates** the database
7. **Starts** the containers

### New project from scratch (legacy templates)

```bash
# Interactive — detects or asks for template
damp new my-project

# Explicit template
damp new frankenphp my-project
```

This creates a new directory with template files (legacy method — Dampfile preferred).

### From the Dashboard

Open https://damp.test → **Projects**:

- **New Project** — Enter a name and select a template. Creates the database and Caddy config. Run `damp new <name>` to scaffold the files.
- **Add Existing Folder** — Browse your filesystem, select a folder. DAMP auto-detects the template, generates a `Dampfile`, creates DB + Caddy config, and starts the containers.

Each project has **play/stop/restart/delete** controls in the dashboard.

### Safe delete and backups

Project deletion is destructive only for DAMP-managed services, not your source files. When you delete a project, DAMP:

- Stops and removes project containers
- Removes generated reverse-proxy config
- Removes the project database
- Automatically creates a database dump if a DB exists

The DB dump is stored in the project root with a timestamped filename:

```bash
<project-name>_db_dump_YYYYMMDD_HHMMSS.sql
```

This gives you a recoverable backup before cleanup.

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
damp up full           # Start DAMP plus every optional service
damp up tools          # Add PHPMyAdmin only (other profiles: mail, cache, postgres)
damp down              # Stop DAMP
damp restart           # Restart DAMP
damp status            # Show service status
damp stats             # Show per-container CPU, RAM, budget usage, and PIDs
damp update            # Pull latest version and rebuild

# Projects (Dampfile workflow)
damp init              # Init existing project interactively (run from project dir)
damp exec my-project    # Open shell in one of the project containers

# Projects (legacy template workflow)
damp new my-project              # Create project (interactive)
damp new frankenphp my-project   # Create with specific template
damp start my-project            # Start a project's containers
damp stop my-project             # Stop a project's containers
damp list                        # List all registered projects
damp exec my-project             # Open shell in a project's container

# Database
damp databases         # List databases
damp create-db mydb    # Create a database
damp drop-db mydb      # Drop a database
damp import mydb dump.sql  # Import SQL dump
damp export mydb           # Export SQL dump

# SSL & DNS
damp trust             # Install Caddy CA in system keychain (HTTPS without warnings)
damp setup-dns         # Install/configure dnsmasq for wildcard *.test DNS (requires sudo)
damp reload            # Reload Caddy after manual config changes
damp add-host domain   # Add a single domain to /etc/hosts (fallback)
```

### Command flow reference

- Engine: `damp up`, `damp down`, `damp restart`, `damp status`
- Projects: `damp new [template] [name]`, `damp init`, `damp start|stop <name>`, `damp list`, `damp exec <name>`
- Databases: `damp databases`, `damp create-db`, `damp drop-db`, `damp export`, `damp import`
- Networking/security: `damp setup-dns`, `damp trust`, `damp reload`, `damp add-host domain`

> If you are getting `502` right after creating/importing a project, wait 20-30 seconds and retry. The container may still be starting.

---

## DNS and domain resolution

DAMP uses the `.test` TLD by default. Every project gets a domain like `my-project.test` that resolves to `127.0.0.1` automatically.

### How it works

During installation, `setup-dns.sh` installs **dnsmasq** natively on your host and configures it so that `*.test` resolves to `127.0.0.1`. This is a host-level DNS resolver — it runs outside Docker, so it works reliably regardless of which Docker runtime you use.

| Platform | What happens |
|----------|-------------|
| **macOS** | dnsmasq installed via Homebrew, `/etc/resolver/test` created pointing to `127.0.0.1` |
| **Linux** | dnsmasq installed via `apt`/`dnf`, systemd-resolved configured for split DNS |
| **WSL2** | dnsmasq installed, `resolv.conf` updated to use local resolver |

On macOS, the installer shows a system password dialog so you don't need to hunt for a blinking terminal prompt.

### Why .test instead of .local?

- `.local` is reserved for **mDNS/Bonjour** on macOS, which causes DNS conflicts and slow resolution
- `.test` is reserved by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761) specifically for testing — no conflicts, no external resolution
- `.test` works cleanly with dnsmasq and custom DNS resolvers

### Custom TLD

You can change the TLD in `core/.env`:

```env
DAMP_TLD=dev    # or .example, .localhost, etc.
```

After changing, run `damp setup-dns` to reconfigure the DNS resolver, and `damp reload` to apply Caddy changes.

### Why not use a Docker container for DNS?

The old approach (`damp-dns` container) used dnsmasq inside Docker with port 53 published to the host. This was unreliable because:

- **macOS/OrbStack**: UDP port forwarding from containers to the host is unreliable. DNS queries (which use UDP) don't reach the container.
- **Linux**: `systemd-resolved` already binds port 53 on the host, causing conflicts.
- **WSL2**: Same as Linux, plus WSL2 manages its own DNS.

Installing dnsmasq natively on the host avoids all these issues — no Docker networking layer between DNS queries and the resolver.

### Troubleshooting DNS

If a project domain doesn't resolve:

```bash
# Re-run DNS setup (will prompt for password)
damp setup-dns

# Verify dnsmasq is running
# macOS:
sudo brew services list | grep dnsmasq
# Linux:
systemctl status dnsmasq

# Test DNS resolution
ping my-project.test
# Should show: PING my-project.test (127.0.0.1) ...
```

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

The web dashboard at https://damp.test provides a premium dark UI with:

- **Overview** — Service status, animated stats cards, quick access links, engine controls
- **Projects** — Tabbed view with project cards showing type, domain, database, and live status
- **Project Import** — Async folder browser with auto-template detection. No hanging — containers start in background
- **Databases** — MySQL and PostgreSQL management (create/drop), Redis status
- **Logs** — Real-time container log streaming
- **Animations** — Staggered entrance animations, hover effects, glow indicators
- **Bilingual** — English and Spanish (toggle in sidebar)

## Migrating from templates to Dampfile

If you have existing projects created with the legacy template system (pre-v0.4.0), you can migrate them:

1. Delete old template files: `rm Dockerfile docker-compose.yml Caddyfile nginx.conf`
2. Run `damp init` from your project directory
3. The interactive wizard will detect your setup and generate a `Dampfile`
4. Commit the `Dampfile` to your repo — it's all you need

## Updating

```bash
damp update
damp reload
```

`damp update` pulls `main`, rebuilds the dashboard, and recreates the core
services. Always run `damp reload` afterward to apply Caddy configuration
changes.

### Upgrading to 0.8

DAMP 0.8 adds bounded runtime resources, observable RAM/CPU/PID usage, runtime
profiles, response compression, and individual service controls in the web and
desktop dashboards.

```bash
damp update
damp reload
damp version
damp stats
```

The dashboard remains available when the other engine services are stopped, so
it can act as the local control plane. Its API is exposed on loopback only by
default. If you previously accessed port `9200` from another machine, use an
explicit, trusted local tunnel instead of publishing the Docker socket control
API to the network.

After updating, the minimal core starts Caddy, MySQL, and the dashboard. Start
optional services from the dashboard or with one of these profiles:

```bash
damp up postgres
damp up cache
damp up tools
damp up mail
damp up full
```

If a new version changes the default TLD or templates, you may also need to run `damp trust` again to update SSL certificates.

## Platform notes

| Platform | Status | DNS approach |
|----------|--------|-------------|
| macOS 12+ (Apple Silicon & Intel) | **Fully supported** | dnsmasq via Homebrew + `/etc/resolver/test`. OrbStack recommended. |
| Linux (Ubuntu, Fedora, Debian) | **Supported** | dnsmasq + systemd-resolved split DNS. Testing welcome. |
| Windows (WSL2) | **Supported** | dnsmasq + custom `resolv.conf`. Testing welcome. |

## License

MIT — see [LICENSE](LICENSE).
