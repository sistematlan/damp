# WordPress on DAMP

This project is configured to run with **DAMP**.

## Setup

1. Create the database: `./damp create-db my-project_db`
2. Add the domain to DAMP:
   - Edit `.env`: `MY_PROJECT_DOMAIN=my-project.local`
   - Edit `caddy/Caddyfile`: 
     ```
     {$MY_PROJECT_DOMAIN} {
         reverse_proxy my-project-app:80
     }
     ```
3. Add the domain to your hosts (if not using auto-DNS): `./damp add-host my-project.local`
4. Start the project: `docker compose up -d`
5. Go to https://my-project.local to start the WordPress install.
