#!/usr/bin/env bash
# =============================================================
#  setup-remote.sh — bootstrap the remote host (Debian/WSL2) as DAMP host
# -------------------------------------------------------------
#  Run this on the remote host, inside Debian/WSL2. It prepares the box
#  to receive code (Mutagen) and run the DAMP stack remotely:
#
#    1. Installs/enables OpenSSH server (so the Mac can connect)
#    2. Ensures your user can run Docker without sudo
#    3. Clones (or updates) the DAMP repo
#    4. Creates core/.env with TLD=test
#    5. Prints the info the Mac side needs (IP, user, paths)
#
#  It does NOT configure Windows port-forwarding or the *.test
#  DNS — those are documented in docs/REMOTE.md because they
#  depend on your network choices.
#
#  Usage (on the remote host):
#    bash setup-remote.sh
#    bash setup-remote.sh --info     # just print connection info
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"
BOLD="\033[1m"; DIM="\033[2m"; NC="\033[0m"

DAMP_REPO="${DAMP_REPO:-https://github.com/sistematlan/damp.git}"
DAMP_DIR="${DAMP_DIR:-$HOME/sourcecode/damp}"
TLD="${DAMP_TLD:-test}"

die() { echo -e "${RED}error:${NC} $*" >&2; exit 1; }
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

print_info() {
  echo ""
  echo -e "${BOLD}── Connection info (use this on the Mac) ──${NC}"
  echo -e "  user            : ${BOLD}$(whoami)${NC}"
  echo -e "  home            : ${BOLD}$HOME${NC}"
  echo -e "  damp dir        : ${BOLD}$DAMP_DIR${NC}"
  echo -e "  damp binary     : ${BOLD}$DAMP_DIR/core/bin/damp${NC}"
  echo -ne "  WSL2 internal IP: ${BOLD}"; hostname -I | awk '{print $1}'; echo -ne "${NC}"
  if is_wsl; then
    echo -e "  ${YELLOW}NOTE:${NC} this WSL2 IP changes on reboot. For stable access from"
    echo -e "  the Mac, set up a Windows port-forward or Tailscale (see docs/REMOTE.md)."
  fi
  echo ""
}

if [ "${1:-}" = "--info" ]; then print_info; exit 0; fi

echo -e "${BOLD}DAMP remote host bootstrap${NC}"
is_wsl && echo -e "${DIM}Detected WSL2.${NC}" || echo -e "${DIM}Native Linux (not WSL).${NC}"

# ── 1. OpenSSH server ──────────────────────────────────────────
echo -e "\n${BOLD}[1/4] OpenSSH server${NC}"
if ! command -v sshd >/dev/null 2>&1; then
  echo -e "${DIM}Installing openssh-server...${NC}"
  sudo apt-get update -y && sudo apt-get install -y openssh-server
else
  echo -e "${GREEN}✔ sshd already installed${NC}"
fi
# Enable + start. On WSL2 systemd may or may not be active.
if command -v systemctl >/dev/null 2>&1 && systemctl --version >/dev/null 2>&1; then
  sudo systemctl enable ssh >/dev/null 2>&1 || true
  sudo systemctl restart ssh || sudo service ssh restart || true
else
  sudo service ssh restart || true
fi
echo -e "${GREEN}✔ sshd running (port 22 inside WSL/Debian)${NC}"

# ── 2. Docker without sudo ─────────────────────────────────────
echo -e "\n${BOLD}[2/4] Docker access${NC}"
command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Engine first."
if docker ps >/dev/null 2>&1; then
  echo -e "${GREEN}✔ docker works without sudo${NC}"
else
  echo -e "${YELLOW}Adding $(whoami) to the docker group...${NC}"
  sudo groupadd docker 2>/dev/null || true
  sudo usermod -aG docker "$(whoami)"
  echo -e "${YELLOW}Log out/in (or run: newgrp docker) for this to take effect.${NC}"
fi

# ── 3. Clone / update DAMP ─────────────────────────────────────
echo -e "\n${BOLD}[3/4] DAMP repo${NC}"
if [ -d "$DAMP_DIR/.git" ]; then
  echo -e "${DIM}Updating existing repo at $DAMP_DIR...${NC}"
  git -C "$DAMP_DIR" pull --ff-only || echo -e "${YELLOW}Could not fast-forward; resolve manually.${NC}"
else
  echo -e "${DIM}Cloning into $DAMP_DIR...${NC}"
  mkdir -p "$(dirname "$DAMP_DIR")"
  git clone "$DAMP_REPO" "$DAMP_DIR"
fi
echo -e "${GREEN}✔ DAMP at $DAMP_DIR${NC}"

# ── 4. core/.env ───────────────────────────────────────────────
echo -e "\n${BOLD}[4/4] Configuration${NC}"
if [ ! -f "$DAMP_DIR/core/.env" ]; then
  cp "$DAMP_DIR/core/.env.example" "$DAMP_DIR/core/.env"
  # Force TLD=test to match the Mac's resolver.
  if grep -q '^DAMP_TLD=' "$DAMP_DIR/core/.env"; then
    sed -i "s/^DAMP_TLD=.*/DAMP_TLD=${TLD}/" "$DAMP_DIR/core/.env"
  else
    echo "DAMP_TLD=${TLD}" >> "$DAMP_DIR/core/.env"
  fi
  echo -e "${GREEN}✔ Created core/.env (DAMP_TLD=${TLD})${NC}"
else
  echo -e "${GREEN}✔ core/.env already exists${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}Remote host bootstrap complete.${NC}"
echo -e "Next: start the stack with ${BOLD}$DAMP_DIR/core/bin/damp up${NC}"
echo -e "(or from the Mac once SSH is wired: ${BOLD}damp-remote up${NC})"
print_info
