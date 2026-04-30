#!/bin/bash
# =============================================================
#  DAMP — Trust Caddy's CA
#  After running this, *.${DAMP_TLD:-test} HTTPS domains work without warnings.
#  Supports: macOS, Linux (Debian/Ubuntu, RHEL/Fedora), WSL2
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
DIM="\033[2m"
BOLD="\033[1m"
NC="\033[0m"

# Load .env for DAMP_TLD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
fi
DAMP_TLD="${DAMP_TLD:-test}"

CERT_PATH="/tmp/damp-caddy-root-ca.crt"
CONTAINER="damp-caddy"

echo -e "${BOLD}DAMP — SSL Certificate Trust${NC}"
echo ""

# Extract CA from Caddy container
echo "Extracting Caddy root CA..."
if ! docker cp "$CONTAINER:/data/caddy/pki/authorities/local/root.crt" "$CERT_PATH" 2>/dev/null; then
  echo -e "${RED}Could not extract CA. Is DAMP running? (damp up)${NC}"
  exit 1
fi

echo "Certificate info:"
openssl x509 -in "$CERT_PATH" -noout -subject -dates 2>/dev/null || true
echo ""

# ── macOS ──────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  if security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain &>/dev/null; then
    echo -e "${YELLOW}Removing old Caddy CA...${NC}"
    sudo security delete-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain 2>/dev/null || true
  fi
  echo "Installing CA in System Keychain (requires sudo)..."
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_PATH"

# ── Linux / WSL2 ───────────────────────────────────────
elif [[ "$OSTYPE" == "linux"* ]]; then
  echo "Installing CA system-wide (requires sudo)..."

  # Debian/Ubuntu
  if [ -d /usr/local/share/ca-certificates ]; then
    sudo cp "$CERT_PATH" /usr/local/share/ca-certificates/caddy-local.crt
    sudo update-ca-certificates
  # RHEL/Fedora/CentOS
  elif [ -d /etc/pki/ca-trust/source/anchors ]; then
    sudo cp "$CERT_PATH" /etc/pki/ca-trust/source/anchors/caddy-local.crt
    sudo update-ca-trust
  else
    echo -e "${YELLOW}Could not detect certificate store.${NC}"
    echo "Manually copy $CERT_PATH to your system's CA directory."
    rm -f "$CERT_PATH"
    exit 1
  fi

  # WSL2: also install on Windows host for browser trust
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo ""
    echo -e "${YELLOW}WSL2 detected — also installing on Windows host...${NC}"
    # Copy cert to a place Windows can definitely see
    CP_CERT="/home/$(whoami)/damp-caddy-root-ca.crt"
    cp "$CERT_PATH" "$CP_CERT"
    WIN_CERT=$(wslpath -w "$CP_CERT" 2>/dev/null || echo "")
    
    if [ -n "$WIN_CERT" ]; then
      echo -e "${DIM}Requesting Windows Admin privileges to install certificate...${NC}"
      # Use PowerShell to start another PowerShell as Admin to run Import-Certificate
      powershell.exe -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile', '-Command', \"Import-Certificate -FilePath '$WIN_CERT' -CertStoreLocation 'Cert:\\LocalMachine\\Root'\" -Verb RunAs -Wait" 2>/dev/null
      echo -e "${GREEN}✓ Windows certificate store updated.${NC}"
    fi
    rm -f "$CP_CERT"
  fi

else
  echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
  rm -f "$CERT_PATH"
  exit 1
fi

echo ""
echo -e "${GREEN}Done! HTTPS domains (*.${DAMP_TLD}) are now trusted.${NC}"
echo "You may need to restart your browser."

rm -f "$CERT_PATH"
