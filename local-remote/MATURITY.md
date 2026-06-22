# DAMP Remote — Maturity Checklist

**Status:** Experimental — lives on `fix/proxy-upstream-container-name`, NOT merged to `main`.

This document tracks what's done, what's missing, and what needs to happen
before this feature can be promoted to a stable release.

---

## ✅ Done & verified

- [x] Core architecture: edit-on-Mac, run-on-remote, sync, DNS, TLS
- [x] `setup-remote.sh` — bootstraps any Linux/WSL2 host (sshd, docker, repo, .env)
- [x] `setup-mac.sh` — onboards any Mac (deps, SSH, DNS, TLS, damp-remote)
- [x] `setup-mac-dns.sh` — repoints `*.test` to remote (with `--revert`)
- [x] `damp-remote` — SSH wrapper for remote `damp` commands
- [x] `damp-adopt` — automated project adoption (7 steps, idempotent)
- [x] `mutagen.yml` — generic sync defaults (sessions auto-generated)
- [x] Portability: zero hardcoded user/IP/path/password values
- [x] README.md — user-facing quickstart + architecture + troubleshooting
- [x] REMOTE.md — full phased reference (600+ lines)
- [x] End-to-end test: Mac → MSI/WSL2 → CI4/frankenphp → HTTPS working

---

## 🔴 Blockers for stable release

### Testing coverage

- [ ] **Test on Intel Mac** (only Apple Silicon verified)
- [ ] **Test remote host without systemd** (WSL2 without `[boot] systemd=true`)
- [ ] **Test remote host as bare-metal Linux** (not WSL2)
- [ ] **Test with Laravel project** (damp-adopt: writable paths differ from CI4)
- [ ] **Test with Node project** (damp-adopt: no composer, different port model)
- [ ] **Test with Symfony project**
- [ ] **Test LAN connection** (no Tailscale — portproxy path)
- [ ] **Test `damp-adopt` on a project without `.env`**
- [ ] **Test `damp-adopt` on a project without `docker-compose.yml`**
- [ ] **Test `damp-adopt --no-db` flow end-to-end**
- [ ] **Test switching local ↔ remote mode back and forth**
- [ ] **Test after remote host reboot** (services auto-start via systemd)
- [ ] **Test after Caddy CA regeneration** (re-trust flow)

### Error handling

- [ ] `damp-adopt`: clean failure if no `docker-compose.yml` (currently may crash)
- [ ] `damp-adopt`: clean failure if no `.env` or unrecognized DB keys
- [ ] `damp-adopt`: handle Mutagen conflict state (two simultaneous edits)
- [ ] `damp-adopt`: timeout message when build takes too long (currently just polls)
- [ ] `setup-mac.sh`: clear error if Homebrew not installed
- [ ] `setup-mac.sh`: handle case where dnsmasq port 53 is already in use
- [ ] `damp-remote`: graceful error if remote Docker daemon is down
- [ ] All scripts: validate SSH connectivity before attempting operations

### Robustness

- [ ] `damp-adopt`: don't use blanket `--ignore-platform-reqs` — detect what's
      actually needed and ignore only those (or document the tradeoff clearly)
- [ ] `damp-adopt`: detect upstream from `hostname:` if no `container_name:`
- [ ] `setup-mac.sh --check`: also verify `*.test` actually resolves (not just config files exist)
- [ ] Handle stray `tailscaled` processes (documented but not auto-cleaned)

---

## 🟡 Should-have before stable

### Testing

- [ ] **At least 1 external user test** (someone follows README from scratch)
- [ ] Smoke test script for the shell scripts (bash automated tests)
- [ ] Test with Cloudflare Tunnel (cooperative access alternative)

### Polish

- [ ] Automated CA re-trust (detect stale CA, re-import without manual curl+security)
- [ ] `damp-remote update` command (pull latest scripts from repo)
- [ ] `damp-remote uninstall` command (clean removal of symlinks, config, DNS)
- [ ] Handle Windows power management from the setup scripts (currently manual PowerShell)
- [ ] `setup-remote.sh`: detect and offer to enable systemd in WSL2
- [ ] Progress indication during long builds (currently just polls in a loop)

### Documentation

- [ ] Test the `curl` one-liner against `main` (currently points to `fix/...` branch)
- [ ] Add section to main DAMP README.md when promoted
- [ ] Video/screencast of the quickstart flow
- [ ] Document Windows-specific edge cases (firewall, portproxy, hibernation)

---

## 🟢 Nice-to-have (post-release)

- [ ] Support for multiple remote hosts (switch between them)
- [ ] Dashboard integration (see remote status from https://damp.test)
- [ ] `damp-adopt` for WordPress projects
- [ ] Automatic DB sync (ongoing, not just initial copy)
- [ ] PhpStorm plugin / VS Code extension for remote awareness
- [ ] Pre-built Mutagen binary download in setup-mac.sh is version-pinned; auto-detect latest
- [ ] Support for PostgreSQL projects in damp-adopt (currently MySQL-only)

---

## Known issues (won't block release but should be documented)

1. **WSL2 IP changes on reboot** — mitigated by Tailscale, but LAN users need portproxy re-run
2. **Wi-Fi Wake-on-LAN unreliable** — documented; cable Ethernet required for WoL
3. **Two stray `tailscaled` processes** in state `T` after manual launch — harmless, clear on WSL restart
4. **`vmIdleTimeout=-1` not always respected** by all WSL2 builds — systemd is the real guarantee
5. **First build of frankenphp takes 2-5 min** — documented but could show better progress

---

## How to promote to stable

When all 🔴 blockers are resolved:

1. Create PR: `fix/proxy-upstream-container-name` → `main`
2. Move `local-remote/` to its final location (decide: keep as `local-remote/` or rename to `remote/`)
3. Update main `README.md` with a "Remote development" section
4. Update the `curl` one-liner to point to `main`
5. Tag a release
6. Announce
