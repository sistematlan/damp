#!/bin/bash
# =============================================================
#  DAMP — Trust Caddy's CA in macOS Keychain
#  After running this, *.local HTTPS domains work without warnings.
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
NC="\033[0m"

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

# Remove old CA if exists
if security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain &>/dev/null; then
  echo -e "${YELLOW}Removing old Caddy CA...${NC}"
  sudo security delete-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain 2>/dev/null || true
fi

# Install new CA
echo "Installing CA in System Keychain (requires sudo)..."
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_PATH"

echo ""
echo -e "${GREEN}Done! HTTPS domains (*.local) are now trusted.${NC}"
echo "You may need to restart your browser."

rm -f "$CERT_PATH"
