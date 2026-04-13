# DAMP

**Docker + Auto-TLS + MySQL + PHP**

A modern, open-source replacement for MAMP, XAMPP, WAMP, and LAMP. One command to get a full local development environment with HTTPS, MySQL, email testing, and project templates.

## What you get

- **Caddy** — Reverse proxy with automatic HTTPS for `*.local` domains
- **MySQL 8.4 & PostgreSQL 16** — Shared database servers
- **Redis 7** — Local cache and session storage
- **PHPMyAdmin** — Database management UI
- **Mailpit** — Catch-all SMTP server for development email testing
- **Project templates** — Start new projects in seconds (WordPress, PHP 8.4, 7.4, 5.6, Node.js)
- **Desktop app** — Native macOS app with System Tray integration

## Requirements

- macOS 12+ / Linux / Windows (WSL2)
- [Docker Desktop](https://docker.com) or [OrbStack](https://orbstack.dev)

## Quick start

```bash
git clone https://github.com/sistematlan/damp.git
cd damp
./install.sh
```

That's it. DAMP is running.

## Services

| Service     | URL                          | Access from containers |
|-------------|------------------------------|----------------------|
| PHPMyAdmin  | http://localhost:8080         | —                    |
| Mailpit     | http://localhost:8025         | damp-mailpit:1025    |
| MySQL       | localhost:3306 (root/root)   | damp-db:3306         |
| PostgreSQL  | localhost:5432 (root/root)   | damp-postgres:5432   |
| Redis       | localhost:6379               | damp-redis:6379      |

With HTTPS (after `./damp trust`):

| Service     | URL                    |
|-------------|------------------------|
| PHPMyAdmin  | https://pma.local      |
| Mailpit     | https://mail.local     |

## CLI

```bash
./damp help          # Show all commands

# Services
./damp up            # Start DAMP
./damp down          # Stop DAMP
./damp status        # Show service status
./damp logs [svc]    # View logs

# Database
./damp databases     # List databases
./damp create-db mydb  # Create a database
./damp drop-db mydb    # Drop a database
./damp import mydb dump.sql  # Import SQL
./damp export mydb           # Export SQL

# Projects
./damp new wordpress my-site       # Create from template
./damp exec my-site                # Enter project container

# SSL & DNS
./damp trust         # Install CA (HTTPS without warnings)
./damp setup-dns     # Configure auto-DNS for *.local (macOS)
./damp reload        # Reload Caddy after config changes
```

## Create a project

```bash
# 1. Create from template
./damp new frankenphp my-project

# 2. Add domain to DAMP
echo 'MY_PROJECT_DOMAIN=my-project.local' >> .env
# Add a block in caddy/Caddyfile:
# {$MY_PROJECT_DOMAIN} {
#     reverse_proxy my-project-app:80
# }

# 3. Add to /etc/hosts and reload
./damp add-host my-project.local
./damp reload

# 4. Start your project
cd my-project
docker compose up -d
```

## Templates

| Template      | Stack                    | Use case                              |
|---------------|--------------------------|---------------------------------------|
| `wordpress`   | WordPress + MySQL        | Blogs, CMS                            |
| `frankenphp`  | PHP 8.4 + FrankenPHP     | CodeIgniter 4, Laravel 11+, Symfony 7 |
| `php-fpm`     | PHP 8.4 + Nginx + FPM   | CI4, Laravel, WordPress, Symfony      |
| `php-legacy`  | PHP 7.4 + Nginx + FPM   | CodeIgniter 3, Laravel 8              |
| `php-ancient`  | PHP 5.6 + Apache         | Legacy rescue                         |
| `node`        | Node.js 22               | React, Vue, Astro, Next.js, Express   |

## Database access

**From your Mac:**
```
Host: localhost
Port: 3306
User: root
Password: root
```

**From containers:**
```
Host: damp-db
Port: 3306
User: root
Password: root
```

## Email testing

Configure your app to use Mailpit as SMTP:

```
Host: damp-mailpit (from containers) / localhost (from Mac)
Port: 1025
Auth: none
TLS: none
```

All emails are captured at http://localhost:8025

## Desktop app

A native macOS app for managing DAMP visually. See [app/README.md](app/README.md).

```bash
cd app
npm install
npm run tauri dev
```

## License

MIT
