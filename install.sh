#!/bin/bash
# =============================================================
#  DAMP Installer
#  Docker + Auto-TLS + MySQL + PHP
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
NC="\033[0m"

DAMP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DAMP_DIR"

echo -e "${BOLD}DAMP Installer${NC}"
echo "────────────────────────────────────────"
echo ""

# ── 1. Check Docker ────────────────────────────────────────
echo -e "${BOLD}[1/5]${NC} Checking Docker..."
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Docker not found.${NC}"
  echo "Install Docker Desktop (https://docker.com) or OrbStack (https://orbstack.dev)"
  exit 1
fi

if ! docker info &>/dev/null; then
  echo -e "${YELLOW}Docker is not running. Trying to start...${NC}"
  if [ -d "/Applications/OrbStack.app" ]; then
    open -a OrbStack
  elif [ -d "/Applications/Docker.app" ]; then
    open -a Docker
  fi
  echo "Waiting for Docker to start..."
  for i in $(seq 1 30); do
    docker info &>/dev/null && break
    sleep 2
  done
  if ! docker info &>/dev/null; then
    echo -e "${RED}Could not start Docker. Please start it manually.${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}Docker is running.${NC}"

# ── 2. Setup .env ──────────────────────────────────────────
echo -e "${BOLD}[2/5]${NC} Setting up configuration..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${GREEN}.env created from .env.example${NC}"
else
  echo -e "${YELLOW}.env already exists, skipping.${NC}"
fi

# ── 3. Start services ─────────────────────────────────────
echo -e "${BOLD}[3/5]${NC} Starting DAMP services..."
docker compose up -d
echo -e "${GREEN}Services started.${NC}"

# ── 4. Wait for MySQL ─────────────────────────────────────
echo -e "${BOLD}[4/5]${NC} Waiting for MySQL..."
for i in $(seq 1 30); do
  if docker exec damp-db mysqladmin ping -uroot -proot &>/dev/null 2>&1; then
    echo -e "${GREEN}MySQL is ready.${NC}"
    break
  fi
  sleep 2
done

# ── 5. Add hosts ───────────────────────────────────────────
echo -e "${BOLD}[5/5]${NC} Configuring /etc/hosts..."
domains=("pma.local" "mail.local")
needs_sudo=false
for domain in "${domains[@]}"; do
  if ! grep -q "127.0.0.1.*$domain" /etc/hosts 2>/dev/null; then
    needs_sudo=true
    break
  fi
done

if [ "$needs_sudo" = true ]; then
  echo "Adding local domains (requires sudo):"
  for domain in "${domains[@]}"; do
    if ! grep -q "127.0.0.1.*$domain" /etc/hosts 2>/dev/null; then
      sudo sh -c "echo '127.0.0.1   $domain' >> /etc/hosts"
      echo -e "  ${GREEN}+ $domain${NC}"
    fi
  done
else
  echo -e "${YELLOW}All domains already configured.${NC}"
fi

# ── Done ───────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo -e "${GREEN}${BOLD}DAMP is ready!${NC}"
echo ""
echo -e "  PHPMyAdmin  → ${BOLD}https://pma.local${NC} or ${BOLD}http://localhost:8080${NC}"
echo -e "  Mailpit     → ${BOLD}https://mail.local${NC} or ${BOLD}http://localhost:8025${NC}"
echo -e "  MySQL       → ${BOLD}localhost:3306${NC} (root/root)"
echo ""
echo -e "  Run ${BOLD}./damp trust${NC} to enable HTTPS without browser warnings."
echo -e "  Run ${BOLD}./damp help${NC} for all commands."
echo ""
