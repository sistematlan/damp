#!/bin/bash
# =============================================================
#  DAMP — Setup DNS Resolver for *.${DAMP_TLD:-test}
#  Supports: macOS, Linux (systemd-resolved, NetworkManager), WSL2
#
#  Strategy: install dnsmasq natively on the host so DNS queries
#  never cross a Docker/VM boundary. This is the only approach
#  that works reliably across all platforms.
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BOLD="\033[1m"
DIM="\033[2m"
NC="\033[0m"

TLD="${DAMP_TLD:-test}"

# ── Sudo caching ──────────────────────────────────────────
# If DAMP_SUDO_PASS was provided (from install.sh), cache sudo.
# Otherwise, on macOS, show a password dialog; on Linux, regular sudo.
if [[ "$OSTYPE" == "darwin"* ]]; then
  if [ -n "${DAMP_SUDO_PASS:-}" ]; then
    echo "$DAMP_SUDO_PASS" | sudo -S true 2>/dev/null
  elif ! sudo -n true 2>/dev/null; then
    DAMP_SUDO_PASS=$(osascript -e 'Tell application "System Events"
  text returned of (display dialog "DAMP needs your password to configure DNS (wildcard *.'${TLD}' resolution)." ¬
  default answer "" ¬
  with hidden answer ¬
  with title "DAMP DNS Setup" ¬
  with icon caution ¬
  buttons {"Cancel","Continue"} ¬
  default button "Continue")
end tell' 2>/dev/null) || true
    if [ -z "$DAMP_SUDO_PASS" ]; then
      echo -e "${RED}Password required. Aborting.${NC}"
      exit 1
    fi
    echo "$DAMP_SUDO_PASS" | sudo -S true 2>/dev/null
  fi
fi

echo -e "${BOLD}DAMP — DNS Resolver Setup${NC}"
echo -e "${DIM}Wildcard *.${TLD} → 127.0.0.1${NC}"
echo ""

# ── Helpers ────────────────────────────────────────────────────

write_dnsmasq_conf() {
  local conf_dir="$1"
  local conf_file="${conf_dir}/damp.conf"
  sudo mkdir -p "$conf_dir"
  # Write via tee to avoid quoting issues with sudo sh -c + heredoc
  printf '# DAMP — wildcard DNS\n# All *.%s resolve to 127.0.0.1\naddress=/.%s/127.0.0.1\n' \
    "$TLD" "$TLD" | sudo tee "$conf_file" > /dev/null
  echo -e "${GREEN}✓ Written: ${conf_file}${NC}"
}

install_dnsmasq_linux() {
  if command -v dnsmasq &>/dev/null; then
    echo -e "${GREEN}✓ dnsmasq already installed${NC}"
    return
  fi
  echo "Installing dnsmasq..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y dnsmasq
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y dnsmasq
  elif command -v pacman &>/dev/null; then
    sudo pacman -Sy --noconfirm dnsmasq
  else
    echo -e "${RED}Cannot install dnsmasq automatically. Install it manually and re-run.${NC}"
    exit 1
  fi
}

restart_dnsmasq_linux() {
  # Some WSL2 distros don't have systemd — fall back to service(8)
  if command -v systemctl &>/dev/null && systemctl is-system-running &>/dev/null 2>&1; then
    sudo systemctl enable dnsmasq
    sudo systemctl restart dnsmasq
  elif command -v service &>/dev/null; then
    sudo service dnsmasq restart
  else
    echo -e "${YELLOW}Could not start dnsmasq automatically. Start it manually: sudo dnsmasq${NC}"
  fi
}

# ── macOS ──────────────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected: macOS"
  echo ""

  # 1. Install dnsmasq via Homebrew if missing
  if ! command -v dnsmasq &>/dev/null; then
    if command -v brew &>/dev/null; then
      echo "Installing dnsmasq via Homebrew..."
      brew install dnsmasq
    else
      echo -e "${RED}Homebrew not found. Install it from https://brew.sh and re-run.${NC}"
      exit 1
    fi
  else
    echo -e "${GREEN}✓ dnsmasq already installed${NC}"
  fi

  # 2. Write damp.conf into dnsmasq's drop-in directory
  DNSMASQ_CONFD="$(brew --prefix)/etc/dnsmasq.d"
  write_dnsmasq_conf "$DNSMASQ_CONFD"

  # 3. Start / restart dnsmasq as a system service (binds to 127.0.0.1:53)
  #    Must use sudo so it can bind port 53
  echo "Starting dnsmasq service (requires sudo)..."
  sudo brew services restart dnsmasq
  echo -e "${GREEN}✓ dnsmasq service running${NC}"

  # 4. Point macOS resolver for the TLD at 127.0.0.1
  echo "Creating /etc/resolver/${TLD} (requires sudo)..."
  sudo mkdir -p /etc/resolver
  printf 'nameserver 127.0.0.1\n' | sudo tee "/etc/resolver/${TLD}" > /dev/null
  echo -e "${GREEN}✓ /etc/resolver/${TLD} created${NC}"

  echo ""
  echo -e "${GREEN}${BOLD}Done!${NC} All *.${TLD} domains resolve to 127.0.0.1."
  echo -e "${DIM}Test: ping anything.${TLD}${NC}"

# ── Linux / WSL2 ───────────────────────────────────────────────
elif [[ "$OSTYPE" == "linux"* ]]; then

  IS_WSL2=false
  if grep -qi microsoft /proc/version 2>/dev/null; then
    IS_WSL2=true
    echo "Detected: WSL2"
  else
    echo "Detected: Linux"
  fi
  echo ""

  install_dnsmasq_linux
  write_dnsmasq_conf "/etc/dnsmasq.d"

  # ── systemd-resolved conflict ──────────────────────────────
  # systemd-resolved may occupy port 53 on 127.0.0.53 (and sometimes
  # 127.0.0.1). Disable its stub listener so dnsmasq can bind :53.
  if command -v systemctl &>/dev/null && \
     systemctl is-active --quiet systemd-resolved 2>/dev/null; then
    echo "Disabling systemd-resolved stub listener (conflicts on port 53)..."
    sudo mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\nDNSStubListener=no\n' | \
      sudo tee /etc/systemd/resolved.conf.d/no-stub.conf > /dev/null
    sudo systemctl restart systemd-resolved
    echo -e "${GREEN}✓ systemd-resolved stub disabled${NC}"
  fi

  # ── DNS routing ─────────────────────────────────────────────
  if $IS_WSL2; then
    # WSL2: Windows manages DNS for the distro via auto-generated resolv.conf.
    # We disable that and point resolv.conf at our local dnsmasq, with a
    # public upstream as fallback so internet still works.
    WSL_CONF="/etc/wsl.conf"
    if ! grep -q "generateResolvConf" "$WSL_CONF" 2>/dev/null; then
      echo "Disabling WSL2 auto-generated resolv.conf..."
      printf '\n[network]\ngenerateResolvConf = false\n' | sudo tee -a "$WSL_CONF" > /dev/null
    fi
    # Write resolv.conf — dnsmasq first, public upstream as fallback
    printf 'nameserver 127.0.0.1\nnameserver 1.1.1.1\n' | sudo tee /etc/resolv.conf > /dev/null
    # Prevent WSL2 from overwriting it on restart
    # (chattr may not be available in all WSL distros — ignore if missing)
    sudo chattr +i /etc/resolv.conf 2>/dev/null || true

    echo -e "${GREEN}✓ resolv.conf set to use local dnsmasq${NC}"

  elif command -v resolvectl &>/dev/null; then
    # Linux with systemd-resolved: configure split DNS so only *.TLD
    # queries are sent to dnsmasq; everything else uses the system resolver.
    echo "Configuring systemd-resolved split DNS for *.${TLD}..."
    sudo mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\nDNS=127.0.0.1\nDomains=~%s\n' "$TLD" | \
      sudo tee /etc/systemd/resolved.conf.d/damp.conf > /dev/null
    sudo systemctl restart systemd-resolved
    echo -e "${GREEN}✓ systemd-resolved split DNS configured${NC}"

  elif command -v nmcli &>/dev/null; then
    # NetworkManager: drop a dnsmasq config and let NM pick it up
    write_dnsmasq_conf "/etc/NetworkManager/dnsmasq.d"
    sudo systemctl restart NetworkManager 2>/dev/null || true
    echo -e "${GREEN}✓ NetworkManager restarted${NC}"

  else
    echo -e "${YELLOW}Could not detect DNS manager.${NC}"
    echo "Wildcard DNS not configured automatically."
    echo "Add individual entries with: damp add-host <domain>"
    echo "Or manually set nameserver 127.0.0.1 in your DNS config."
  fi

  restart_dnsmasq_linux
  echo -e "${GREEN}✓ dnsmasq running${NC}"

  echo ""
  echo -e "${GREEN}${BOLD}Done!${NC} All *.${TLD} domains resolve to 127.0.0.1."
  if $IS_WSL2; then
    echo -e "${YELLOW}Restart WSL2 (wsl --shutdown) for resolv.conf changes to take effect.${NC}"
  fi
  echo -e "${DIM}Test: ping anything.${TLD}${NC}"

else
  echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
  echo "DAMP supports macOS, Linux, and WSL2."
  exit 1
fi
