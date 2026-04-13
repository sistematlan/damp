#!/bin/bash
# =============================================================
#  DAMP Installer
#  Dockerized Auto-SSL Modern Platform
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
DIM="\033[2m"
NC="\033[0m"

# Resolve real path even if called via symlink
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
BIN_DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
DAMP_CORE="$(cd "$BIN_DIR/.." && pwd)"
DAMP_ROOT="$(cd "$DAMP_CORE/.." && pwd)"
cd "$DAMP_CORE"

TOTAL_STEPS=7
STEP=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${BOLD}[${STEP}/${TOTAL_STEPS}]${NC} $1"
}

# ── Header ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}  DAMP Installer${NC} ${DIM}v$(cat "$DAMP_ROOT/VERSION" 2>/dev/null || echo "0.2.0")${NC}"
echo -e "  ${DIM}Dockerized Auto-SSL Modern Platform${NC}"
echo "  ────────────────────────────────────────"

# ── Detect OS ──────────────────────────────────────────
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
elif [[ "$OSTYPE" == "linux"* ]]; then
  OS="linux"
fi

# ── 1. Check Docker ───────────────────────────────────
step "Checking Docker..."

if ! command -v docker &>/dev/null; then
  echo -e "${RED}  Docker not found.${NC}"
  echo ""
  if [ "$OS" = "macos" ]; then
    echo -e "  ${BOLD}Recommended:${NC} Install OrbStack (lightweight, fast)"
    echo -e "  ${DIM}→ https://orbstack.dev${NC}"
    echo ""
    echo -e "  ${DIM}Alternative: Docker Desktop${NC}"
    echo -e "  ${DIM}→ https://docker.com/products/docker-desktop${NC}"
  elif [ "$OS" = "linux" ]; then
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo -e "  ${BOLD}WSL2 detected.${NC} Install Docker Desktop for Windows:"
      echo -e "  ${DIM}→ https://docker.com/products/docker-desktop${NC}"
      echo -e "  ${DIM}Enable WSL2 integration in Docker Desktop settings.${NC}"
    else
      echo -e "  Install Docker Engine:"
      echo -e "  ${DIM}→ https://docs.docker.com/engine/install/${NC}"
    fi
  fi
  echo ""
  echo -e "  Run ${BOLD}./install.sh${NC} again after installing Docker."
  exit 1
fi

if ! docker info &>/dev/null; then
  echo -e "${YELLOW}  Docker is installed but not running.${NC}"
  if [ "$OS" = "macos" ]; then
    if [ -d "/Applications/OrbStack.app" ]; then
      echo -e "  ${DIM}Starting OrbStack...${NC}"
      open -a OrbStack
    elif [ -d "/Applications/Docker.app" ]; then
      echo -e "  ${DIM}Starting Docker Desktop...${NC}"
      open -a Docker
    fi
  elif [ "$OS" = "linux" ]; then
    # Try starting Docker service on Linux
    if command -v systemctl &>/dev/null; then
      echo -e "  ${DIM}Trying to start Docker service...${NC}"
      sudo systemctl start docker 2>/dev/null || true
    fi
  fi
  echo -e "  ${DIM}Waiting for Docker to be ready...${NC}"
  for i in $(seq 1 30); do
    docker info &>/dev/null && break
    sleep 2
  done
  if ! docker info &>/dev/null; then
    echo -e "${RED}  Docker did not start. Please start it manually and re-run ./install.sh${NC}"
    exit 1
  fi
fi

DOCKER_RUNTIME="Docker"
if docker info 2>/dev/null | grep -q "orbstack"; then
  DOCKER_RUNTIME="OrbStack"
fi
echo -e "${GREEN}  $DOCKER_RUNTIME is running.${NC}"

# ── 2. Setup .env ─────────────────────────────────────
step "Setting up configuration..."

if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${GREEN}  .env created from template.${NC}"
else
  echo -e "${DIM}  .env already exists, keeping current config.${NC}"
fi

# ── 3. Start services ────────────────────────────────
step "Starting DAMP services..."
echo -e "${DIM}  Pulling images and starting containers (first time may take a few minutes)...${NC}"
docker compose up -d 2>&1 | grep -E "Started|Running|Created|Pulling" | sed 's/^/  /'

# ── 4. Wait for databases ────────────────────────────
step "Waiting for databases..."

echo -n "  MySQL:      "
for i in $(seq 1 30); do
  if docker exec damp-db mysqladmin ping -uroot -proot &>/dev/null 2>&1; then
    echo -e "${GREEN}ready${NC}"
    break
  fi
  echo -n "."
  sleep 2
done

echo -n "  PostgreSQL: "
for i in $(seq 1 15); do
  if docker exec damp-postgres pg_isready -U root &>/dev/null 2>&1; then
    echo -e "${GREEN}ready${NC}"
    break
  fi
  echo -n "."
  sleep 2
done

echo -n "  Redis:      "
if docker exec damp-redis redis-cli ping &>/dev/null 2>&1; then
  echo -e "${GREEN}ready${NC}"
else
  echo -e "${YELLOW}waiting...${NC}"
fi

# ── 5. SSL Certificate ───────────────────────────────
step "Setting up HTTPS..."
echo -e "${DIM}  Installing Caddy CA so browsers trust *.local certificates.${NC}"

if bash "$BIN_DIR/trust-cert.sh" 2>/dev/null; then
  echo -e "${GREEN}  HTTPS configured — no browser warnings.${NC}"
else
  echo -e "${YELLOW}  Could not install CA automatically.${NC}"
  echo -e "  ${DIM}Run ${BOLD}damp trust${NC}${DIM} manually later to enable HTTPS.${NC}"
fi

# ── 6. DNS + hosts ────────────────────────────────────
step "Configuring DNS..."

# Try auto-DNS first (eliminates need for /etc/hosts per project)
dns_configured=false
if [ "$OS" = "macos" ]; then
  if sudo mkdir -p /etc/resolver 2>/dev/null && \
     sudo sh -c "echo 'nameserver 127.0.0.1' > /etc/resolver/${DAMP_TLD:-test}" 2>/dev/null; then
    dns_configured=true
    echo -e "${GREEN}  Auto-DNS configured — all *.local domains resolve automatically.${NC}"
  fi
elif [ "$OS" = "linux" ]; then
  if command -v resolvectl &>/dev/null; then
    if sudo mkdir -p /etc/systemd/resolved.conf.d 2>/dev/null && \
       sudo sh -c "echo -e '[Resolve]\nDNS=127.0.0.1\nDomains=~${DAMP_TLD:-test}' > /etc/systemd/resolved.conf.d/damp.conf" 2>/dev/null && \
       sudo systemctl restart systemd-resolved 2>/dev/null; then
      dns_configured=true
      echo -e "${GREEN}  Auto-DNS configured via systemd-resolved.${NC}"
    fi
  fi
fi

if [ "$dns_configured" = false ]; then
  echo -e "${DIM}  Auto-DNS not available. Adding domains to /etc/hosts...${NC}"
  TLD="${DAMP_TLD:-test}"
  domains=("damp.${TLD}" "pma.${TLD}" "mail.${TLD}")
  for domain in "${domains[@]}"; do
    if ! grep -q "127.0.0.1.*$domain" /etc/hosts 2>/dev/null; then
      if sudo sh -c "echo '127.0.0.1   $domain' >> /etc/hosts" 2>/dev/null; then
        echo -e "  ${GREEN}+ $domain${NC}"
      fi
    else
      echo -e "  ${DIM}~ $domain (already configured)${NC}"
    fi
  done
fi

# ── 7. Add damp to PATH ──────────────────────────────
step "Installing damp command..."

DAMP_BIN="$BIN_DIR/damp"
if [ -L /usr/local/bin/damp ] && [ "$(readlink /usr/local/bin/damp)" = "$DAMP_BIN" ]; then
  echo -e "${DIM}  damp is already installed at /usr/local/bin/damp${NC}"
else
  if sudo ln -sf "$DAMP_BIN" /usr/local/bin/damp 2>/dev/null; then
    echo -e "${GREEN}  damp is now available globally.${NC}"
  else
    echo -e "${YELLOW}  Could not add to PATH. Use ./damp from the project directory.${NC}"
  fi
fi

# ── Done ──────────────────────────────────────────────
echo ""
echo "  ────────────────────────────────────────"
echo -e "${GREEN}${BOLD}  DAMP is ready!${NC}"
echo ""
TLD="${DAMP_TLD:-test}"
echo -e "  ${BOLD}Services:${NC}"
echo -e "    Dashboard   ${DIM}→${NC} ${BOLD}https://damp.${TLD}${NC}      ${DIM}http://localhost:9200${NC}"
echo -e "    PHPMyAdmin  ${DIM}→${NC} ${BOLD}https://pma.${TLD}${NC}       ${DIM}http://localhost:8080${NC}"
echo -e "    Mailpit     ${DIM}→${NC} ${BOLD}https://mail.${TLD}${NC}      ${DIM}http://localhost:8025${NC}"
echo ""
echo -e "  ${BOLD}Databases:${NC}"
echo -e "    MySQL       ${DIM}→${NC} localhost:3306  ${DIM}(root/root)${NC}"
echo -e "    PostgreSQL  ${DIM}→${NC} localhost:5432  ${DIM}(root/root)${NC}"
echo -e "    Redis       ${DIM}→${NC} localhost:6379"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    ${GREEN}damp new my-project${NC}   Create your first project"
echo -e "    ${GREEN}damp help${NC}             See all commands"
echo ""
