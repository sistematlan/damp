# DAMP Remote

**Edit on your laptop. Run the stack on another machine.**

DAMP Remote lets you keep your IDE and browser on your daily machine (Mac)
while the full DAMP stack — Caddy, MySQL, Redis, Mailpit, your project
containers — runs on a beefier box somewhere else on your network.

Think of it as a **local ngrok**: your `*.test` domains resolve to the remote
machine, with trusted HTTPS, zero tunneling services, and sub-second file sync.

---

## Why would you want this?

| Problem | DAMP Remote solves it |
|---------|----------------------|
| Docker/OrbStack eats your laptop's RAM and battery | The stack runs on the remote box; your Mac stays cool |
| Your Mac is an M-series with 8-16GB; containers + IDE = swap hell | Offload Docker to a 32GB+ machine; edit locally |
| You want a collaborator to see your local dev site | They join your Tailscale tailnet and hit your `*.test` URL |
| You need to test on a real Linux environment, not macOS | WSL2/Debian gives you production-matching behavior |

---

## How it works

```
┌──────────────────────────┐          ┌───────────────────────────────────┐
│  Your Mac (the editor)   │          │  Remote host (the runner)         │
│                          │          │  Linux / WSL2 + Docker Engine     │
│  PhpStorm / VS Code      │          │                                   │
│  Mutagen sync ───────────┼── SSH ───┼─→ ~/sourcecode/<project>         │
│  damp-remote (control) ──┼── SSH ───┼─→ damp up / start / status       │
│  dnsmasq: *.test → IP    │          │     Caddy :80/:443                │
│  Browser                 │          │     MySQL / Redis / Mailpit …     │
│      https://x.test ─────┼──────────┼─→ Caddy on the remote             │
└──────────────────────────┘          └───────────────────────────────────┘
              connected via Tailscale (or your LAN)
```

**Three pieces make it work:**

1. **Code sync (Mutagen)** — every save on your Mac appears on the remote in
   under a second. Dependencies (`vendor/`, `node_modules/`) are excluded;
   they're installed on the remote, not copied over the wire.

2. **Remote control (`damp-remote`)** — run any `damp` command from your Mac
   and it executes on the remote over SSH. `damp-remote up`, `damp-remote
   status`, `damp-remote logs caddy` — same as local, but remote.

3. **DNS + TLS** — your Mac resolves `*.test` to the remote machine's IP, and
   the remote's Caddy serves trusted HTTPS. Your browser sees
   `https://my-project.test` with a green lock, no warnings.

---

## Requirements

**On the remote host** (the "runner"):

- Linux (bare metal, VM, or WSL2 on Windows)
- Docker Engine installed and working
- SSH access enabled
- The DAMP repo cloned (the bootstrap script does this for you)

**On your Mac** (the "editor"):

- macOS 12+
- Homebrew installed
- An SSH key (`~/.ssh/id_ed25519` or similar)

**Recommended for both:**

- [Tailscale](https://tailscale.com) — gives you a stable IP that survives
  reboots and network changes, no port-forwarding or firewall rules needed.
  Also enables cooperative access (share your dev URL with teammates).

---

## Quick start (3 commands)

### 1. Bootstrap the remote host

On the remote machine (inside Debian/WSL2 if using Windows):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sistematlan/damp/fix/proxy-upstream-container-name/local-remote/setup-remote.sh)
```

Or if you already have the repo:

```bash
bash ~/sourcecode/damp/local-remote/setup-remote.sh
```

This installs/enables `sshd`, adds your user to the `docker` group, clones DAMP,
and creates `core/.env`. At the end it prints your **username**, **home**,
**damp path**, and **internal IP** — write those down.

### 2. Prepare your Mac

```bash
bash ~/sourcecode/damp/local-remote/setup-mac.sh
```

This interactive script handles everything on the Mac side:

- Checks/installs **Tailscale**, **dnsmasq**, and **Mutagen**
- Creates an **SSH alias** (`damp-host`) to the remote
- Points **`*.test` DNS** at the remote machine
- Trusts the remote's **Caddy root CA** (green-lock HTTPS)
- Installs **`damp-remote`** and **`damp-adopt`** into your PATH

It asks for: the remote username, IP (Tailscale `100.x` recommended), SSH port,
and repo path. You can also pass them as flags:

```bash
bash local-remote/setup-mac.sh --host damp-host --user alice --ip 100.x.y.z --port 22
```

Verify everything wired up:

```bash
bash local-remote/setup-mac.sh --check
```

### 3. Adopt a project

From anywhere on your Mac:

```bash
damp-adopt ~/sourcecode/my-project
```

This single command:

1. Generates and starts **Mutagen sync** (Mac → remote)
2. **Builds and starts** the project's containers on the remote
3. **Registers the domain** in the remote's Caddy + reloads
4. Runs **`composer install`** on the remote (PHP projects)
5. Creates **CI4 `writable/`** dirs (if applicable)
6. Creates the **database + user** (reads credentials from your `.env`),
   and offers to **copy your local DB** to the remote
7. **Verifies** `https://my-project.test` responds

It's **idempotent** — run it again on an already-adopted project and it just
verifies everything is healthy, without breaking anything.

```bash
open https://my-project.test
```

---

## Daily workflow

Once set up, your daily loop is:

```bash
# 1. (once per session) make sure sync is running
cd ~/sourcecode/my-project
mutagen project start

# 2. edit in your IDE — changes sync to the remote automatically

# 3. when you need to interact with the stack:
damp-remote status           # what's running?
damp-remote logs my-project  # tail project logs
damp-remote exec my-project  # shell into the container

# 4. open in your browser — it just works
open https://my-project.test
```

### Adopting more projects

```bash
damp-adopt ~/sourcecode/another-project
open https://another-project.test
```

### Controlling the remote stack

`damp-remote` is a thin SSH wrapper — anything you'd do with `damp`, you do with
`damp-remote`:

```bash
damp-remote up               # start the DAMP engine on the remote
damp-remote down             # stop it
damp-remote status           # service + project status
damp-remote logs caddy       # tail Caddy logs
damp-remote exec my-project  # shell into a project container
damp-remote import my_db dump.sql   # stream a local SQL file to the remote DB
```

---

## Switching between remote and local mode

When you want to run DAMP locally again (e.g., working offline):

```bash
cd ~/sourcecode/damp
./local-remote/setup-mac-dns.sh --revert    # *.test → 127.0.0.1 (your Mac)
```

Start OrbStack/Docker locally, and your `*.test` domains point at your Mac again.

To go back to remote mode:

```bash
./local-remote/setup-mac-dns.sh 100.x.y.z   # your remote's Tailscale IP
```

---

## Cooperative access (share your dev URL)

Because the connection runs over **Tailscale**, you can share your dev
environment with teammates:

1. Invite them to your Tailscale tailnet (free for personal use).
2. They add a DNS entry pointing `*.test` to **your remote's** Tailscale IP.
3. They open `https://my-project.test` in their browser.

No ngrok, no Cloudflare Tunnel, no public exposure. Just your private tailnet.

---

## Keeping the remote awake

If the remote is a laptop (e.g., a Windows laptop running WSL2), it may
suspend when idle. To prevent this **when plugged in**, run in PowerShell
(Admin) on the remote:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

And in `C:\Users\<you>\.wslconfig` (Windows side):

```ini
[wsl2]
vmIdleTimeout=-1
```

With `systemd=true` in WSL2, Docker, sshd, and Tailscale auto-start on reboot.
See [REMOTE.md](REMOTE.md#mantener-la-remote host-despierta-que-no-se-duerma) for
full details, including Wake-on-LAN notes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `*.test` resolves to `127.0.0.1` instead of the remote | dnsmasq may be reading `/etc/hosts`; add `no-hosts` to `damp.conf` and restart dnsmasq. See [REMOTE.md Fase 2](REMOTE.md) |
| HTTPS gives `tlsv1 alert internal error` | Caddy has stale certs; run `damp-remote reload` |
| `HTTP 503` on a CI4 project | Missing `writable/` dir; `damp-adopt` creates it, or see [REMOTE.md](REMOTE.md) |
| `Failed opening required .../vendor/...` | Missing dependencies; run `damp-adopt` (step 4) or `composer install` on the remote |
| Intermittent timeouts / `HTTP 000` | The remote may have gone to sleep; check with `nc -z <IP> 22` |
| `damp-remote` says "cannot SSH" | Key not copied yet: `ssh-copy-id damp-host` |

For the full troubleshooting table and diagnostic commands, see
[REMOTE.md](REMOTE.md#troubleshooting).

---

## Files in this directory

| File | What it does |
|------|-------------|
| [`setup-remote.sh`](setup-remote.sh) | Bootstrap the **remote host** (sshd, docker, repo, .env) |
| [`setup-mac.sh`](setup-mac.sh) | Onboard your **Mac** (deps, SSH, DNS, TLS, damp-remote) |
| [`damp-adopt`](damp-adopt) | Adopt a **project** on the remote, end-to-end, idempotent |
| [`damp-remote`](damp-remote) | Run any `damp` command on the **remote** over SSH |
| [`setup-mac-dns.sh`](setup-mac-dns.sh) | Point `*.test` at the remote (or `--revert` to local) |
| [`mutagen.yml`](mutagen.yml) | Sync defaults template (sessions generated by `damp-adopt`) |
| [`REMOTE.md`](REMOTE.md) | **Full reference** — phased guide, deep dives, troubleshooting |

---

## Deep dive

For the complete phased guide with every command, architecture details,
manual steps, and the full troubleshooting reference, see
[**REMOTE.md**](REMOTE.md).
