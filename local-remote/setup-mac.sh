#!/usr/bin/env bash
# =============================================================
#  setup-mac.sh — prepare THIS Mac to drive a remote DAMP host
# -------------------------------------------------------------
#  Run this ON YOUR MAC. It wires the local side of the
#  "edit local, run remote" workflow against a remote host (or any
#  Linux/WSL2 box) that already ran local-remote/setup-remote.sh.
#
#  It is idempotent and asks before doing anything with sudo.
#  Nothing here is specific to any single user/machine — every
#  value (SSH host, user, IP del host remoto, repo path) is provided by you.
#
#  What it does (each step can be skipped):
#    1. Check/Install deps: Tailscale, dnsmasq, mutagen
#    2. SSH: ensure a key + ~/.ssh/config alias to the remote host
#    3. DNS: point *.<TLD> at the remote host (via setup-mac-dns.sh)
#    4. TLS: trust the remote host Caddy root CA (HTTPS without warnings)
#    5. damp-remote: symlink into PATH + write config
#
#  Usage:
#    bash local-remote/setup-mac.sh
#    bash local-remote/setup-mac.sh --host damp-host --user youruser \
#         --ip 100.x.y.z --remote-dir '~/sourcecode/damp' --port 22 --tld test
#    bash local-remote/setup-mac.sh --check     # verify an existing setup
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"
BOLD="\033[1m"; DIM="\033[2m"; NC="\033[0m"

# Resolve the damp repo root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die()  { echo -e "${RED}error:${NC} $*" >&2; exit 1; }
info() { echo -e "${DIM}$*${NC}"; }
ok()   { echo -e "${GREEN}✔${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

ask() {
  # ask "Prompt" "default"  -> echoes the answer (default if empty)
  local prompt="$1" default="${2:-}" ans=""
  if [ -n "$default" ]; then
    printf "%s [%s]: " "$prompt" "$default" >&2
  else
    printf "%s: " "$prompt" >&2
  fi
  read -r ans </dev/tty || ans=""
  echo "${ans:-$default}"
}

confirm() {
  local prompt="$1" ans=""
  printf "%s [Y/n]: " "$prompt" >&2
  read -r ans </dev/tty || ans="Y"
  [ "$ans" != "n" ] && [ "$ans" != "N" ]
}

# ── Defaults / args ────────────────────────────────────────────
# If an existing damp-remote config is present, use its host as the default
# so --check respects what the user already has set up.
_ssh_default="damp-host"
if [ -f "$HOME/.config/damp-remote/config" ]; then
  _ssh_default="$(grep -E '^DAMP_REMOTE_HOST=' "$HOME/.config/damp-remote/config" | cut -d= -f2 | tr -d '\r' || true)"
  [ -n "$_ssh_default" ] || _ssh_default="damp-host"
fi
SSH_HOST="$_ssh_default"
SSH_USER=""
REMOTE_IP=""
SSH_PORT="22"
REMOTE_DIR='~/sourcecode/damp'
TLD="test"
CHECK_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --host)       SSH_HOST="$2"; shift 2 ;;
    --user)       SSH_USER="$2"; shift 2 ;;
    --ip)         REMOTE_IP="$2"; shift 2 ;;
    --port)       SSH_PORT="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --tld)        TLD="$2"; shift 2 ;;
    --check)      CHECK_ONLY=1; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,40p'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || die "This script is for macOS. on the remote host use setup-remote.sh."

# ── --check mode ───────────────────────────────────────────────
if [ "$CHECK_ONLY" = "1" ]; then
  echo -e "${BOLD}DAMP Mac setup — check${NC}"
  command -v mutagen >/dev/null 2>&1 && ok "mutagen: $(mutagen version 2>/dev/null)" || warn "mutagen missing"
  command -v damp-remote >/dev/null 2>&1 && ok "damp-remote in PATH" || warn "damp-remote not in PATH"
  if [ -f "$HOME/.ssh/config" ] && grep -q "Host ${SSH_HOST}\b" "$HOME/.ssh/config"; then
    ok "ssh alias '${SSH_HOST}' present"
    if ssh -o ConnectTimeout=8 -o BatchMode=yes "$SSH_HOST" 'echo ok && docker ps >/dev/null 2>&1' >/dev/null 2>&1; then
      ok "ssh + docker reachable on '${SSH_HOST}'"
    else
      warn "cannot ssh/docker on '${SSH_HOST}' (key not copied, host down, or docker perms)"
    fi
  else
    warn "no ssh alias '${SSH_HOST}' in ~/.ssh/config"
  fi
  dnsconf="$(brew --prefix 2>/dev/null)/etc/dnsmasq.d/damp.conf"
  if [ -f "$dnsconf" ]; then
    ok "dnsmasq damp.conf: $(grep -m1 '^address=' "$dnsconf" 2>/dev/null)"
    grep -q '^no-hosts' "$dnsconf" 2>/dev/null && ok "dnsmasq: no-hosts set" || warn "dnsmasq: no-hosts NOT set (/etc/hosts may override)"
  else
    warn "dnsmasq damp.conf missing (run without --check to configure)"
  fi
  security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain >/dev/null 2>&1 \
    && ok "Caddy root CA trusted" || warn "Caddy root CA not trusted (HTTPS will warn)"
  exit 0
fi

echo -e "${BOLD}DAMP — prepare this Mac for remote DAMP${NC}"
echo -e "${DIM}Repo: ${REPO_DIR}${NC}\n"

# Gather connection details if not provided.
[ -n "$SSH_USER" ] || SSH_USER="$(ask "Remote user on the remote host (from setup-remote.sh output)")"
[ -n "$SSH_USER" ] || die "remote user is required"
[ -n "$REMOTE_IP" ]   || REMOTE_IP="$(ask "IP del host remoto (Tailscale 100.x recommended, or LAN IP)")"
[ -n "$REMOTE_IP" ]   || die "IP del host remoto is required"
SSH_PORT="$(ask "SSH port (22 for Tailscale, 2222 for Windows portproxy)" "$SSH_PORT")"
REMOTE_DIR="$(ask "Path to the damp repo on the remote host" "/home/${SSH_USER}/sourcecode/damp")"
TLD="$(ask "DAMP TLD" "$TLD")"

# ── 1. Dependencies ────────────────────────────────────────────
echo -e "\n${BOLD}[1/5] Dependencies${NC}"
command -v brew >/dev/null 2>&1 || die "Homebrew required: https://brew.sh"

if ! command -v tailscale >/dev/null 2>&1 && [ ! -d /Applications/Tailscale.app ]; then
  if confirm "Tailscale not found. Install it (brew --cask tailscale)?"; then
    brew install --cask tailscale && open -a Tailscale || warn "install Tailscale manually"
    warn "Log in to Tailscale (menu bar) with the SAME account used on the remote host, then re-run."
  fi
else
  ok "Tailscale present"
fi

if ! brew list dnsmasq >/dev/null 2>&1; then
  confirm "dnsmasq not installed. Install it?" && brew install dnsmasq || warn "dnsmasq needed for *.${TLD} resolution"
else
  ok "dnsmasq present"
fi

if ! command -v mutagen >/dev/null 2>&1; then
  if confirm "mutagen not installed. Install it?"; then
    if ! brew install mutagen-io/mutagen/mutagen 2>/dev/null; then
      warn "brew install failed; falling back to prebuilt binary"
      arch="$(uname -m)"; mt="arm64"; [ "$arch" = "x86_64" ] && mt="amd64"
      ver="$(curl -fsSL https://api.github.com/repos/mutagen-io/mutagen/releases/latest | grep -oE '"tag_name": "[^"]+"' | head -1 | sed -E 's/.*"(v[^"]+)".*/\1/')"
      [ -n "$ver" ] || ver="v0.18.1"
      tmp="$(mktemp -d)"; ( cd "$tmp" && curl -fsSL -o m.tgz "https://github.com/mutagen-io/mutagen/releases/download/${ver}/mutagen_darwin_${mt}_${ver}.tar.gz" && tar xzf m.tgz && mkdir -p "$HOME/.local/bin" && cp mutagen mutagen-agents.tar.gz "$HOME/.local/bin/" && chmod +x "$HOME/.local/bin/mutagen" )
      echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin" || warn "Add \$HOME/.local/bin to your PATH"
    fi
  fi
else
  ok "mutagen present"
fi

# ── 2. SSH key + alias ─────────────────────────────────────────
echo -e "\n${BOLD}[2/5] SSH${NC}"
[ -f "$HOME/.ssh/id_ed25519" ] || { info "Generating SSH key..."; ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" -C "mac→${SSH_HOST}"; }

mkdir -p "$HOME/.ssh"; touch "$HOME/.ssh/config"; chmod 600 "$HOME/.ssh/config"
if grep -qE "^Host ${SSH_HOST}\b" "$HOME/.ssh/config"; then
  ok "ssh alias '${SSH_HOST}' already in ~/.ssh/config (leaving as-is)"
else
  {
    echo ""
    echo "Host ${SSH_HOST}"
    echo "    HostName ${REMOTE_IP}"
    echo "    User ${SSH_USER}"
    echo "    Port ${SSH_PORT}"
    echo "    ServerAliveInterval 30"
  } >> "$HOME/.ssh/config"
  ok "Added ssh alias '${SSH_HOST}'"
fi

if ssh -o ConnectTimeout=8 -o BatchMode=yes "$SSH_HOST" 'echo ok' >/dev/null 2>&1; then
  ok "Passwordless SSH to '${SSH_HOST}' works"
else
  warn "Copy your key to the remote host (you'll be asked for the remote password once):"
  echo -e "  ${BOLD}ssh-copy-id ${SSH_HOST}${NC}"
  confirm "Run ssh-copy-id now?" && ssh-copy-id "$SSH_HOST" || warn "Do it later, then re-run with --check"
fi

# ── 3. DNS: *.<TLD> → remote host ──────────────────────────────────────
echo -e "\n${BOLD}[3/5] DNS (*.${TLD} → ${REMOTE_IP})${NC}"
if confirm "Point *.${TLD} on this Mac at the remote host now? (uses sudo)"; then
  DAMP_TLD="$TLD" bash "$SCRIPT_DIR/setup-mac-dns.sh" "$REMOTE_IP" || warn "DNS step had issues; see Fase 2 in REMOTE.md"
  # Ensure dnsmasq ignores /etc/hosts so stale 127.0.0.1 *.TLD entries don't win.
  dnsconf="$(brew --prefix)/etc/dnsmasq.d/damp.conf"
  if [ -f "$dnsconf" ] && ! grep -q '^no-hosts' "$dnsconf"; then
    printf '\n# Ignore /etc/hosts so stale 127.0.0.1 *.%s never override the wildcard.\nno-hosts\n' "$TLD" >> "$dnsconf"
    sudo brew services restart dnsmasq >/dev/null 2>&1 || true
    sudo dscacheutil -flushcache 2>/dev/null || true; sudo killall -HUP mDNSResponder 2>/dev/null || true
    ok "dnsmasq set to ignore /etc/hosts (no-hosts)"
  fi
else
  info "Skipped. Later: ./local-remote/setup-mac-dns.sh ${REMOTE_IP}"
fi

# ── 4. TLS: trust the remote host Caddy root CA ────────────────────────
echo -e "\n${BOLD}[4/5] TLS (trust remote host Caddy CA)${NC}"
if security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain >/dev/null 2>&1; then
  ok "A Caddy root CA is already trusted"
else
  if ssh -o ConnectTimeout=8 -o BatchMode=yes "$SSH_HOST" 'true' >/dev/null 2>&1; then
    if confirm "Fetch and trust the remote host Caddy root CA? (uses sudo)"; then
      tmpcrt="/tmp/damp-remote host-root.crt"
      if ssh "$SSH_HOST" 'docker exec damp-caddy cat /data/caddy/pki/authorities/local/root.crt' > "$tmpcrt" 2>/dev/null && [ -s "$tmpcrt" ]; then
        sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$tmpcrt" \
          && ok "Trusted remote host Caddy root CA (restart your browser)" || warn "Could not add cert"
      else
        warn "Could not read CA from remote host (is the stack up? 'damp-remote up')"
      fi
    fi
  else
    warn "SSH not ready; do the TLS step after ssh-copy-id (see Fase 2 in REMOTE.md)"
  fi
fi

# ── 5. damp-remote in PATH + config ────────────────────────────
echo -e "\n${BOLD}[5/5] damp-remote${NC}"
mkdir -p "$HOME/.config/damp-remote"
cat > "$HOME/.config/damp-remote/config" <<EOF
DAMP_REMOTE_HOST=${SSH_HOST}
DAMP_REMOTE_DIR=${REMOTE_DIR}
DAMP_REMOTE_PORT=${SSH_PORT}
EOF
ok "Wrote ~/.config/damp-remote/config"

chmod +x "$SCRIPT_DIR/damp-remote" "$SCRIPT_DIR/damp-adopt" 2>/dev/null || true
LINK_TARGET=""
for d in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
  case ":$PATH:" in *":$d:"*) LINK_TARGET="$d"; break ;; esac
done
[ -n "$LINK_TARGET" ] || LINK_TARGET="$HOME/.local/bin"
mkdir -p "$LINK_TARGET"
for tool in damp-remote damp-adopt; do
  if [ -w "$LINK_TARGET" ]; then
    ln -sf "$SCRIPT_DIR/$tool" "$LINK_TARGET/$tool" && ok "Linked $tool → $LINK_TARGET"
  else
    warn "Need sudo to link $tool into $LINK_TARGET. Run:"
    echo -e "  ${BOLD}sudo ln -sf ${SCRIPT_DIR}/${tool} ${LINK_TARGET}/${tool}${NC}"
  fi
done

echo ""
echo -e "${GREEN}${BOLD}Mac setup complete.${NC}"
echo -e "Verify:   ${BOLD}bash local-remote/setup-mac.sh --check${NC}"
echo -e "Channel:  ${BOLD}damp-remote --check${NC}"
echo -e "Adopt a project: ${BOLD}damp-adopt <project-dir>${NC}"
