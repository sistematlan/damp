# DAMP Remote — editar local, ejecutar en otra máquina

Guía para **editar código en el Mac** (PhpStorm) y **correr el stack DAMP en una
máquina más potente** (una MSI Thin con Win11 + Debian/WSL2 + Docker Engine, 32GB
RAM). El objetivo es liberar al Mac de OrbStack/Docker y PhpStorm compitiendo por
recursos.

## Arquitectura

```
┌─────────────────────────┐         ┌──────────────────────────────────┐
│  Mac (Apple Silicon)    │         │  MSI Thin · Win11 · 32GB         │
│  - PhpStorm (editar)    │         │  └ Debian (WSL2) + Docker Engine │
│  - Mutagen (sync) ──────┼── SSH ──┼─→ ~/sourcecode/<proyecto>        │
│  - damp-remote (deploy) ┼── SSH ──┼─→ damp up / start                │
│  - dnsmasq:             │         │     Caddy :80/:443               │
│      *.test → IP-MSI    │         │     MySQL / Redis / Mailpit …    │
│  - navegador            │         │                                  │
│      https://x.test ────┼─────────┼─→ Caddy en la MSI                │
└─────────────────────────┘         └──────────────────────────────────┘
        red local de casa (LAN)
```

Tres piezas:

1. **Sync de código (Mutagen)** — Mac → MSI, tiempo real, ignora `vendor/`, `node_modules/`.
2. **Deploy remoto (`damp-remote`)** — corre cualquier comando `damp` en la MSI por SSH.
3. **Resolución `*.test`** — el navegador del Mac resuelve los dominios a la IP de la MSI.

Todos los scripts viven en [`local-remote/`](.).

---

## Resumen de fases

| Fase | Dónde | Qué |
|------|-------|-----|
| 0 | MSI + router | Red estable + SSH del Mac a la MSI |
| 1 | MSI | DAMP corriendo |
| 2 | Mac | `*.test` → IP de la MSI |
| 3 | Mac | Sync de código (Mutagen) |
| 4 | Mac | Deploy remoto (`damp-remote`) |
| 5 | — | (Opcional) acceso cooperativo tipo ngrok |

---

## Fase 0 — Red + SSH (prerequisito)

WSL2 vive tras un NAT interno de Windows: su IP `172.x` **cambia en cada reinicio**
y no es visible directamente en tu LAN. Hay que resolver dos cosas: que la MSI tenga
una dirección **estable** y que el Mac pueda **entrar por SSH** a la Debian.

### 0.1 — IP estable de la MSI

Elige una opción:

- **Reserva DHCP (recomendado para LAN de casa):** en tu router (gateway
  `192.168.68.1`), reserva una IP fija para la MAC de la MSI (p. ej.
  `192.168.68.42`). Así la MSI siempre tiene la misma IP en Windows.
- **Tailscale:** instala Tailscale en Mac y MSI; obtienes una IP `100.x` estable
  que además sirve para el acceso cooperativo (Fase 5). Inmune a cambios de red.

> A partir de aquí, `IP-MSI` = la IP estable que elegiste.

### 0.2 — SSH del Mac hacia la Debian/WSL2

El reto: el `sshd` corre dentro de WSL2 (IP `172.x` interna), pero el Mac solo ve
la IP de **Windows** (`IP-MSI`). Necesitas un **port-forward** de Windows → WSL2.

**En la MSI, dentro de Debian/WSL2:**

```bash
# Clona el repo damp y prepara SSH + Docker + .env de un tiro:
bash <(curl -fsSL https://raw.githubusercontent.com/sistematlan/damp/fix/proxy-upstream-container-name/local-remote/setup-msi.sh)
# o, si ya tienes el repo:
bash ~/sourcecode/damp/local-remote/setup-msi.sh
```

Esto instala/activa `sshd`, te mete al grupo `docker`, clona DAMP y crea
`core/.env` con `DAMP_TLD=test`. Al final imprime el **usuario**, **home**,
**ruta de damp** y la **IP interna de WSL2** (la vas a necesitar abajo).

**En la MSI, en PowerShell como Administrador**, reenvía el puerto 2222 de Windows
hacia el `sshd` de WSL2 y abre el firewall:

```powershell
# Toma la IP interna de WSL2 (la que imprimió setup-msi.sh, p.ej. 172.20.x.x)
$wslIp = (wsl hostname -I).Trim().Split(" ")[0]

# Reenvía el puerto 2222 de Windows → 22 de WSL2
netsh interface portproxy add v4tov4 listenport=2222 listenaddress=0.0.0.0 connectport=22 connectaddress=$wslIp

# Abre el puerto en el firewall de Windows
New-NetFirewallRule -DisplayName "WSL2 SSH" -Direction Inbound -LocalPort 2222 -Protocol TCP -Action Allow

# Verifica
netsh interface portproxy show v4tov4
```

> **Ojo:** la IP interna de WSL2 cambia al reiniciar. Si pierdes SSH tras un
> reboot, vuelve a correr el bloque `portproxy` (o automatízalo con una tarea
> programada que lo actualice al iniciar sesión). Tailscale evita este problema
> por completo.

**En el Mac**, genera una llave (si no tienes) y crea un alias SSH cómodo:

```bash
# Llave (si no existe)
test -f ~/.ssh/id_ed25519 || ssh-keygen -t ed25519 -C "mac→msi-damp"

# Copia la llave a la MSI (usa el puerto 2222 y el usuario que imprimió setup-msi.sh)
ssh-copy-id -p 2222 TU_USUARIO@IP-MSI
```

Agrega a `~/.ssh/config` en el Mac:

```sshconfig
Host msi-damp
    HostName IP-MSI
    User TU_USUARIO
    Port 2222
    ServerAliveInterval 30
```

Prueba: `ssh msi-damp 'echo ok && docker ps'` debe responder sin pedir password.

---

## Fase 1 — DAMP corriendo en la MSI

Ya quedó instalado por `setup-msi.sh`. Arráncalo:

```bash
ssh msi-damp '~/sourcecode/damp/core/bin/damp up'
```

Verifica:

```bash
ssh msi-damp '~/sourcecode/damp/core/bin/damp status'
```

Deberías ver `damp-caddy`, `damp-db`, etc. en estado *running*. Caddy escucha en
`:80`/`:443` **de la MSI**.

> El comando `damp setup-dns` de la MSI configura DNS para el navegador **local de
> la MSI**. En este modelo el navegador está en el Mac, así que **no** dependemos
> de ese DNS; lo resolvemos en el Mac (Fase 2). Sí conviene `damp trust` para el
> CA, pero como el navegador es el del Mac, ver "TLS" más abajo.

---

## Fase 2 — Resolver `*.test` en el Mac → IP de la MSI

Hoy tu dnsmasq del Mac resuelve `*.test → 127.0.0.1` (modo local). Hay que
repuntarlo a la MSI:

```bash
cd ~/sourcecode/damp
./local-remote/setup-mac-dns.sh IP-MSI       # p.ej. ./local-remote/setup-mac-dns.sh 192.168.68.42
```

Verifica:

```bash
./local-remote/setup-mac-dns.sh --status
ping -c1 damp.test     # debe responder desde IP-MSI
```

Para **volver al modo local** (cuando quieras usar DAMP en el Mac otra vez):

```bash
./local-remote/setup-mac-dns.sh --revert     # *.test → 127.0.0.1
```

### TLS / HTTPS sin warnings (`https://miproyecto.test`)

Caddy en la MSI usa su CA interna para emitir los certificados `*.test`. Como el
navegador es el del **Mac**, hay que confiar en **esa** CA en el Mac:

```bash
# 1) Copia el root CA de Caddy desde la MSI al Mac
ssh msi-damp 'docker exec damp-caddy cat /data/caddy/pki/authorities/local/root.crt' > /tmp/damp-msi-root.crt

# 2) Conf​ía en él en el llavero del sistema del Mac
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /tmp/damp-msi-root.crt
```

Reinicia el navegador. Si Chrome se queja por HSTS, limpia
`chrome://net-internals/#hsts`. (Repite si Caddy regenera su CA.)

---

## Fase 3 — Sync de código (Mutagen)

Instala Mutagen en el Mac:

```bash
brew install mutagen-io/mutagen/mutagen
```

Configura el proyecto a sincronizar. Copia la plantilla y edítala:

```bash
cp ~/sourcecode/damp/local-remote/mutagen.yml ~/sourcecode/mi-proyecto/mutagen.yml
```

Edita el bloque `sync.project` (o crea uno por proyecto):

```yaml
sync:
  miproyecto:
    alpha: "/Users/christianhernandez/sourcecode/miproyecto"
    beta:  "msi-damp:/home/TU_USUARIO/sourcecode/miproyecto"
```

> `alpha` = Mac (tú editas), `beta` = MSI (los contenedores leen). El `host` es el
> alias SSH `msi-damp` de la Fase 0. Los `ignore` ya excluyen `vendor/`,
> `node_modules/`, cachés y dirs writable de CI4/Laravel/Symfony.

Arranca el sync:

```bash
cd ~/sourcecode/mi-proyecto
mutagen project start
mutagen sync list          # verifica estado "Watching for changes"
```

Ahora cada cambio en el Mac aparece en la MSI en sub-segundo. Para detener:
`mutagen project terminate`.

### Alternativa / complemento: PhpStorm SFTP

Si prefieres el deployment nativo del IDE (o como respaldo):

1. **Settings → Build, Execution, Deployment → Deployment → +SFTP**.
2. SSH config: el `msi-damp` (host `IP-MSI`, puerto `2222`, tu usuario+llave).
3. **Root path:** `/home/TU_USUARIO/sourcecode`.
4. **Mappings:** local `…/miproyecto` → deployment `/miproyecto`.
5. **Options → Upload changed files automatically to the default server →
   *On explicit save action*** (o *Always*).
6. Excluir `vendor`, `node_modules`, cachés en **Excluded Paths**.

> No uses Mutagen y SFTP sobre el **mismo** proyecto a la vez; elige uno para
> evitar conflictos de escritura. Mutagen para el día a día; SFTP útil para
> empujar un proyecto puntual sin daemon.

---

## Fase 4 — Deploy remoto (`damp-remote`)

Instala el wrapper en el PATH del Mac y configúralo:

```bash
# Symlink al PATH (ajusta si /usr/local/bin no está en tu PATH)
sudo ln -sf ~/sourcecode/damp/local-remote/damp-remote /usr/local/bin/damp-remote

# Config
mkdir -p ~/.config/damp-remote
cat > ~/.config/damp-remote/config <<'EOF'
DAMP_REMOTE_HOST=msi-damp
DAMP_REMOTE_DIR=/home/TU_USUARIO/sourcecode/damp
DAMP_REMOTE_PORT=2222
EOF
```

Verifica todo el canal (SSH + binario damp + Docker en la MSI):

```bash
damp-remote --check
```

Úsalo como usarías `damp`, pero ejecuta en la MSI:

```bash
damp-remote up                       # levanta el core en la MSI
damp-remote start miproyecto         # arranca contenedores del proyecto
damp-remote status
damp-remote logs caddy
damp-remote exec miproyecto          # shell dentro del contenedor (TTY)
damp-remote import mi_db dump.sql    # sube el .sql LOCAL y lo importa en la MSI
damp-remote --shell                  # shell en la MSI dentro del repo damp
```

### Flujo de trabajo diario

```bash
# 1) (una vez por sesión) sync encendido
cd ~/sourcecode/miproyecto && mutagen project start

# 2) editar en PhpStorm en el Mac → se sincroniza solo

# 3) cuando necesites (re)construir/levantar contenedores:
damp-remote start miproyecto

# 4) abrir en el navegador del Mac:
open https://miproyecto.test
```

### Adoptar un proyecto nuevo en la MSI

Como `damp init` es interactivo y detecta tipo de proyecto, córrelo en la MSI
**después** de que el código ya esté sincronizado allá:

```bash
# (asegúrate que mutagen ya copió el proyecto a la MSI)
ssh -t msi-damp 'cd ~/sourcecode/miproyecto && ~/sourcecode/damp/core/bin/damp init'
```

---

## Fase 5 — Acceso cooperativo (tipo ngrok) — opcional, para después

Cuando quieras que un colaborador externo vea tus `*.test`:

- **Tailscale (recomendado):** red privada entre tus equipos y los del colaborador;
  comparten IPs `100.x`. Resuelve también el cambio de IP de WSL2 y el SSH de la
  Fase 0. El colaborador agrega un `*.test → tu-IP-100.x` en su propio dnsmasq/hosts.
- **Cloudflare Tunnel:** publica una URL pública apuntando a Caddy de la MSI
  (`cloudflared tunnel --url http://localhost:80`). URL compartible con cualquiera,
  sin que instalen nada.
- **ngrok directo:** `ngrok http https://miproyecto.test` para demos puntuales.

Se documentará en detalle cuando lo abordemos.

---

## Mantener la MSI despierta (que no se duerma)

La MSI corre headless (la editas desde el Mac), así que Windows la considera
"inactiva" y la suspende/hiberna, matando WSL2, Docker, Tailscale y sshd. WSL2
mismo está bien (systemd activo: Docker, sshd y tailscaled arrancan solos tras
un reboot); el problema es **Windows**.

### Windows: no dormir cuando está enchufada

WSL2 con systemd ya levanta los servicios solo; basta evitar que Windows duerma.
En **PowerShell como Administrador** en la MSI (solo `-ac` = enchufada, para no
drenar la batería):

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

> Resultado: **enchufada** nunca duerme → siempre accesible por Tailscale
> (`100.x`). **Con batería** se comporta normal (duerme si la dejas sola) para no
> vaciarla; al despertarla/enchufarla, systemd vuelve a levantar todo.

### WSL2: que no apague la VM por inactividad

En `C:\Users\<usuario>\.wslconfig` (en Windows):

```ini
[wsl2]
vmIdleTimeout=-1
```

Luego, una vez: `wsl --shutdown` en PowerShell y reabre Debian.

### Wake-on-LAN — solo por cable Ethernet (pendiente)

Para despertar la MSI por red tras dormir, WoL **solo es confiable por cable
Ethernet**. Por **Wi-Fi (WoWLAN)** la mayoría de tarjetas no lo soportan desde
hibernación/apagado, así que no se documenta aquí todavía. El magic packet debe
enviarse a la **MAC + IP de la LAN física** (no la IP `100.x` de Tailscale, que
está muerta mientras la MSI duerme), desde un equipo en la misma red local.

Cuando se conecte por cable, habilitar en PowerShell (Admin) y luego enviar el
magic packet desde el Mac (`brew install wakeonlan`; `wakeonlan <MAC>`):

```powershell
# Reemplaza "Ethernet" por el Name real (Get-NetAdapter)
Set-NetAdapterPowerManagement -Name "Ethernet" -WakeOnMagicPacket Enabled
powercfg /deviceenablewake "$((Get-NetAdapter -Name 'Ethernet').InterfaceDescription)"
```

---

## Apagar OrbStack en el Mac

Una vez que el flujo remoto funcione y ya no corras contenedores en el Mac:

```bash
# Detén OrbStack (libera CPU/RAM/batería)
osascript -e 'quit app "OrbStack"'
# Opcional: quítalo del arranque en OrbStack → Settings → "Start at login"
```

Si algún día quieres volver al modo 100% local: arranca OrbStack y corre
`./local-remote/setup-mac-dns.sh --revert`.

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `ssh msi-damp` falla tras reiniciar la MSI | IP interna de WSL2 cambió | Re-corre el bloque `portproxy` en PowerShell, o usa Tailscale |
| `miproyecto.test` no resuelve en el Mac | dnsmasq no repuntado / cache | `./local-remote/setup-mac-dns.sh --status`, luego `sudo dscacheutil -flushcache` |
| Resuelve pero da timeout | Firewall de Windows bloquea 80/443 hacia WSL2 | Abre 80/443 en el firewall y reenvía esos puertos como en 0.2 |
| `502 Bad Gateway` | Contenedor del proyecto aún arrancando | Espera 20-30s; `damp-remote logs` |
| Cert no confiable en el navegador | CA de la MSI no importada en el Mac | Repite el bloque TLS de la Fase 2 |
| Cambios no llegan a la MSI | Mutagen pausado o en conflicto | `mutagen sync list`; reanuda/flush; revisa `ignore` |
| Web carga pero assets/Vite no | Vite no escucha en `0.0.0.0` | `damp init` aplica el patch de `vite.config`; revisa `allowedHosts` |

---

## Archivos de este setup

- [`local-remote/setup-msi.sh`](setup-msi.sh) — bootstrap de la MSI (SSH, Docker, repo, `.env`).
- [`local-remote/setup-mac-dns.sh`](setup-mac-dns.sh) — repunta `*.test` del Mac a la MSI (y `--revert`).
- [`local-remote/mutagen.yml`](mutagen.yml) — plantilla de sync Mac → MSI.
- [`local-remote/damp-remote`](damp-remote) — ejecuta comandos `damp` en la MSI por SSH.
