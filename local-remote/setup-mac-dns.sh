#!/usr/bin/env bash
# =============================================================
#  setup-mac-dns.sh — point *.test on the Mac to the remote host
# -------------------------------------------------------------
#  In the standard (local) DAMP setup, the Mac's dnsmasq resolves
#  *.test → 127.0.0.1, because Caddy runs locally. When you move
#  the DAMP stack to the remote host, the browser on the Mac must resolve
#  *.test → the remote host's IP instead.
#
#  This script rewrites the existing DAMP dnsmasq entry to point at
#  the remote host, and (re)installs the /etc/resolver/test file. It is
#  idempotent and can be reverted with: --revert (back to 127.0.0.1).
#
#  Usage:
#    ./setup-mac-dns.sh 192.168.68.42      # point *.test → remote host IP
#    ./setup-mac-dns.sh --revert           # point *.test → 127.0.0.1
#    ./setup-mac-dns.sh --status           # show current target
#
#  Requirements: Homebrew dnsmasq (already installed on this Mac).
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"
BOLD="\033[1m"; DIM="\033[2m"; NC="\033[0m"

TLD="${DAMP_TLD:-test}"
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
DNSMASQ_CONF_DIR="${BREW_PREFIX}/etc/dnsmasq.d"
DAMP_CONF="${DNSMASQ_CONF_DIR}/damp.conf"
RESOLVER_FILE="/etc/resolver/${TLD}"

die() { echo -e "${RED}error:${NC} $*" >&2; exit 1; }

current_target() {
  if [ -f "$DAMP_CONF" ]; then
    grep -oE "address=/\.?${TLD}/[0-9.]+" "$DAMP_CONF" 2>/dev/null \
      | head -1 | sed "s#address=/\.\{0,1\}${TLD}/##"
  fi
}

show_status() {
  echo -e "${BOLD}DAMP DNS status (TLD: .${TLD})${NC}"
  local t; t="$(current_target || true)"
  echo -e "  dnsmasq conf : ${DAMP_CONF}"
  echo -e "  *.${TLD} → ${BOLD}${t:-<not set>}${NC}"
  if [ -f "$RESOLVER_FILE" ]; then
    echo -e "  resolver     : $(cat "$RESOLVER_FILE")"
  else
    echo -e "  resolver     : ${DIM}<missing ${RESOLVER_FILE}>${NC}"
  fi
}

apply_target() {
  local ip="$1"

  command -v brew >/dev/null 2>&1 || die "Homebrew not found."
  brew list dnsmasq >/dev/null 2>&1 || die "dnsmasq not installed. Run: brew install dnsmasq"

  mkdir -p "$DNSMASQ_CONF_DIR"

  # Write the wildcard record pointing at the chosen IP.
  cat > "$DAMP_CONF" <<EOF
# DAMP — wildcard DNS (managed by setup-mac-dns.sh)
# All *.${TLD} resolve to the host running the DAMP stack.
address=/.${TLD}/${ip}
EOF
  echo -e "${GREEN}✔ Wrote ${DAMP_CONF} → *.${TLD} = ${ip}${NC}"

  # Ensure the macOS resolver for this TLD exists (queries .test via 127.0.0.1
  # dnsmasq, which then answers with the remote host IP from the record above).
  if [ ! -f "$RESOLVER_FILE" ] || ! grep -q "127.0.0.1" "$RESOLVER_FILE" 2>/dev/null; then
    echo -e "${DIM}Installing ${RESOLVER_FILE} (requires sudo)...${NC}"
    sudo mkdir -p /etc/resolver
    echo "nameserver 127.0.0.1" | sudo tee "$RESOLVER_FILE" >/dev/null
  fi

  # Restart dnsmasq so it reloads the record.
  echo -e "${DIM}Restarting dnsmasq...${NC}"
  sudo brew services restart dnsmasq >/dev/null 2>&1 \
    || brew services restart dnsmasq >/dev/null 2>&1 \
    || echo -e "${YELLOW}Could not auto-restart dnsmasq. Restart it manually.${NC}"

  # Flush macOS DNS cache.
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true

  echo ""
  echo -e "${GREEN}${BOLD}Done.${NC} Verify with:"
  echo -e "  ${DIM}dscacheutil -q host -a name damp.${TLD}${NC}"
  echo -e "  ${DIM}ping -c1 damp.${TLD}   # should show ${ip}${NC}"
}

case "${1:-}" in
  ""|-h|--help)
    cat <<EOF
${BOLD}setup-mac-dns.sh${NC} — point *.${TLD} on the Mac to the DAMP host

  ./setup-mac-dns.sh <REMOTE_IP>   Point *.${TLD} → remote host IP (remote mode)
  ./setup-mac-dns.sh --revert   Point *.${TLD} → 127.0.0.1 (local mode)
  ./setup-mac-dns.sh --status   Show current target
EOF
    ;;
  --status) show_status ;;
  --revert)
    apply_target "127.0.0.1"
    echo -e "${YELLOW}Reverted to local mode (127.0.0.1).${NC}" ;;
  *)
    ip="$1"
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid IP: $ip"
    apply_target "$ip" ;;
esac
