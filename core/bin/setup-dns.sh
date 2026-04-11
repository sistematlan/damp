#!/bin/bash
# =============================================================
#  DAMP — Setup DNS Resolver for *.local
#  Configures the host to use DAMP's local DNS server for .local
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
NC="\033[0m"

echo -e "${BOLD}DAMP — DNS Resolver Setup${NC}"
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS..."
  echo "Creating /etc/resolver/local (requires sudo)..."
  sudo mkdir -p /etc/resolver
  sudo sh -c "echo 'nameserver 127.0.0.1' > /etc/resolver/local"
  echo -e "${GREEN}Done! macOS now uses 127.0.0.1 for all *.local domains.${NC}"
elif [[ "$OSTYPE" == "linux"* ]]; then
  echo "Detected Linux..."
  echo -e "${YELLOW}Automatic DNS setup for Linux is complex due to different managers.${NC}"
  echo "Suggested manual steps (if using systemd-resolved):"
  echo "  1. Add 'nameserver 127.0.0.1' to /etc/resolv.conf (as first entry)"
  echo "  2. Or configure NetworkManager to use 127.0.0.1 for local domains."
else
  echo -e "${RED}Unsupported OS for automatic DNS setup.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}DNS setup complete.${NC}"
echo "Test it with: ping my-app.local"
echo "(Note: DAMP container 'damp-dns' must be running on port 53)"
