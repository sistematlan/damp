#!/bin/bash
# =============================================================
#  DAMP — Setup DNS Resolver for *.local
#  Supports: macOS, Linux (systemd-resolved), WSL2
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
NC="\033[0m"

echo -e "${BOLD}DAMP — DNS Resolver Setup${NC}"
echo ""

# ── macOS ──────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS."
  echo "Creating /etc/resolver/${DAMP_TLD:-local} (requires sudo)..."
  sudo mkdir -p /etc/resolver
  sudo sh -c "echo 'nameserver 127.0.0.1' > /etc/resolver/${DAMP_TLD:-local}"
  echo -e "${GREEN}Done! All *.${DAMP_TLD:-local} domains now resolve to 127.0.0.1.${NC}"

# ── Linux ──────────────────────────────────────────────
elif [[ "$OSTYPE" == "linux"* ]]; then

  # WSL2 detection
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Detected WSL2."
    echo -e "${YELLOW}DNS in WSL2 is managed by Windows.${NC}"
    echo ""
    echo "Option 1 — Edit /etc/wsl.conf to prevent DNS override:"
    echo "  [network]"
    echo "  generateResolvConf = false"
    echo ""
    echo "Option 2 — Add entries to Windows hosts file:"
    echo "  notepad C:\\Windows\\System32\\drivers\\etc\\hosts"
    echo "  Add: 127.0.0.1  damp.local pma.local mail.local"
    echo ""
    echo "Option 3 — Use damp add-host for each project domain."

  # systemd-resolved (Ubuntu 18+, Fedora, etc.)
  elif command -v resolvectl &>/dev/null; then
    echo "Detected systemd-resolved."
    echo "Configuring *.local to resolve via DAMP DNS (requires sudo)..."
    sudo mkdir -p /etc/systemd/resolved.conf.d
    sudo sh -c 'cat > /etc/systemd/resolved.conf.d/damp.conf << CONF
[Resolve]
DNS=127.0.0.1
Domains=~${DAMP_TLD:-local}
CONF'
    sudo systemctl restart systemd-resolved
    echo -e "${GREEN}Done! All *.${DAMP_TLD:-local} domains now resolve via DAMP DNS.${NC}"

  # NetworkManager (older systems)
  elif command -v nmcli &>/dev/null; then
    echo "Detected NetworkManager."
    echo -e "${YELLOW}Automatic setup not supported for NetworkManager.${NC}"
    echo "Add this to /etc/NetworkManager/dnsmasq.d/damp.conf:"
    echo "  address=/.local/127.0.0.1"
    echo "Then: sudo systemctl restart NetworkManager"

  # Fallback
  else
    echo -e "${YELLOW}Could not detect DNS manager.${NC}"
    echo "Add to /etc/resolv.conf:"
    echo "  nameserver 127.0.0.1"
    echo "Or use: damp add-host <domain> for each project."
  fi

else
  echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
  exit 1
fi

echo ""
echo "Test: ping my-project.local"
echo "(DAMP container 'damp-dns' must be running on port 53)"
