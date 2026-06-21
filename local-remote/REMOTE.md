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
| 0 | MSI + router | Red estable + SSH del Mac a la MSI (**Tailscale recomendado**) |
| 1 | MSI | DAMP corriendo |
| 2 | Mac | `*.test` → IP de la MSI (dnsmasq + `no-hosts` + TLS) |
| 3 | Mac | Sync de código (Mutagen) |
| 4 | Mac | Deploy remoto (`damp-remote`) |
| — | MSI | Adoptar un proyecto nuevo (receta completa, en Fase 4) |
| 5 | — | (Opcional) acceso cooperativo tipo ngrok |

> **Ejemplo de referencia (sustituye por lo tuyo):** una MSI con Win11 +
> Debian/WSL2 (systemd activo) + Docker Engine, conectada por **Tailscale**.
> En los comandos verás valores de muestra como IP-MSI `100.x.y.z`, usuario
> `<tu-usuario>` y repo en `~/sourcecode/damp`. **Nada está fijado a un equipo
> concreto**: cada valor lo provees tú (o lo detectan los scripts). Alias SSH
> sugerido: `msi-damp` (puerto 22 con Tailscale).

---

## Quickstart (vía automática, recomendada)

Dos scripts hacen casi todo. No tienen rutas ni credenciales fijas: todo se
detecta o se pregunta.

```bash
# En la MSI (Debian/WSL2): bootstrap del host
bash ~/sourcecode/damp/local-remote/setup-msi.sh        # imprime user, IP, paths

# En el Mac: prepara el lado local (deps, SSH, DNS, TLS, damp-remote)
bash ~/sourcecode/damp/local-remote/setup-mac.sh        # interactivo; pregunta user/IP/puerto
bash ~/sourcecode/damp/local-remote/setup-mac.sh --check # verifica el estado

# Adoptar cualquier proyecto (sync + build + ruta + composer + writable + DB)
damp-adopt ~/sourcecode/mi-proyecto
```

`damp-adopt` es **idempotente**: si un proyecto ya está adoptado, lo verifica sin
romper nada. Las fases de abajo explican cada paso por si prefieres hacerlo a
mano o necesitas depurar.

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
- **Tailscale (lo que usamos en producción de este setup):** instala Tailscale en
  Mac y MSI; obtienes una IP `100.x` estable que además sirve para el acceso
  cooperativo (Fase 5). Inmune a cambios de red y evita el port-forward de
  Windows por completo (ver 0.2). **Recomendado.**

> A partir de aquí, `IP-MSI` = la IP estable que elegiste. En este setup real fue
> la IP Tailscale de la MSI: `100.x.y.z`.

#### Camino Tailscale (recomendado, sin portproxy)

Como Tailscale corre **dentro** de WSL2 igual que `sshd` y Caddy, el Mac llega
directo a los puertos de WSL2 (`22`, `80`, `443`) por la IP `100.x`. **No hace
falta** el `netsh portproxy` ni abrir el firewall de Windows.

**En la MSI (Debian/WSL2):**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
# Con systemd activo en WSL2 (lo recomendado):
sudo systemctl enable --now tailscaled
sudo tailscale up        # imprime una URL → ábrela y autentica en el navegador
tailscale ip -4          # anota la IP 100.x → esta es tu IP-MSI
```

> Si tu WSL2 **no** tiene systemd, arranca el daemon en modo userspace:
> `sudo tailscaled --tun=userspace-networking --socks5-server=localhost:1055 &`
> y luego `sudo tailscale up`. (Mejor habilitar systemd en `/etc/wsl.conf` con
> `[boot]\nsystemd=true` y `wsl --shutdown`.)

**En el Mac:**

```bash
brew install --cask tailscale
open -a Tailscale         # inicia sesión con la MISMA cuenta (ícono barra de menú → Log in)
```

Verifica conectividad (ICMP puede no pasar por Tailscale; usa TCP):

```bash
nc -z -G 6 100.x.y.z 22 && echo "SSH alcanzable"
```

Con Tailscale resuelto, **salta la sección 0.2** (port-forward) y ve directo a la
llave SSH más abajo (usando puerto `22`, no `2222`).

### 0.2 — SSH del Mac hacia la Debian/WSL2 (solo camino LAN/portproxy)


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

# Copia la llave a la MSI.
#   - Camino Tailscale: puerto 22       → ssh-copy-id TU_USUARIO@IP-MSI
#   - Camino LAN/portproxy: puerto 2222 → ssh-copy-id -p 2222 TU_USUARIO@IP-MSI
ssh-copy-id TU_USUARIO@IP-MSI
```

Agrega a `~/.ssh/config` en el Mac (con Tailscale, `Port 22`; con portproxy, `Port 2222`):

```sshconfig
Host msi-damp
    HostName IP-MSI          # p.ej. 100.x.y.z (Tailscale)
    User TU_USUARIO          # el que imprimió setup-msi.sh
    Port 22                  # 2222 si usas el portproxy de Windows
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
./local-remote/setup-mac-dns.sh IP-MSI       # p.ej. ./local-remote/setup-mac-dns.sh 100.x.y.z
```

Verifica:

```bash
./local-remote/setup-mac-dns.sh --status
dscacheutil -q host -a name damp.test        # debe mostrar IP-MSI
```

> **ICMP/ping puede no responder** por Tailscale aunque todo funcione; valida con
> TCP/HTTP, no con `ping`.

Para **volver al modo local** (cuando quieras usar DAMP en el Mac otra vez):

```bash
./local-remote/setup-mac-dns.sh --revert     # *.test → 127.0.0.1
```

### Dos trampas reales que hay que destrabar (las vivimos)

Tras correr el script, `damp.test` puede seguir resolviendo a `127.0.0.1`. Causas
y arreglos:

**1) dnsmasq no estaba corriendo.** El script intenta reiniciarlo pero a veces
falla en silencio. Arráncalo (escucha en el puerto 53, requiere sudo):

```bash
sudo brew services restart dnsmasq
```

**2) `/etc/hosts` pisa a dnsmasq.** Si tenías entradas estáticas `127.0.0.1
xxx.test` de tu modo local previo, **`/etc/hosts` gana siempre** sobre el wildcard
de dnsmasq. Hay dos arreglos (aplica ambos para quedar robusto):

```bash
# a) Comenta las entradas .test estáticas (respaldo incluido)
sudo cp /etc/hosts /etc/hosts.bak.$(date +%Y%m%d)
sudo sed -i '' -E 's/^([[:space:]]*127\.0\.0\.1[[:space:]].*\.test.*)$/# \1/' /etc/hosts

# b) Que dnsmasq IGNORE /etc/hosts por completo (lo dejamos permanente)
#    Añade `no-hosts` al conf gestionado:
printf '\n# Ignore /etc/hosts so stale 127.0.0.1 *.test never override the wildcard.\nno-hosts\n' \
  >> "$(brew --prefix)/etc/dnsmasq.d/damp.conf"
sudo brew services restart dnsmasq
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

Verifica que dnsmasq sirve el wildcard a la MSI:

```bash
dig +short @127.0.0.1 cualquier.test    # debe devolver IP-MSI
dig +short @127.0.0.1 damp.test         # debe devolver IP-MSI (no 127.0.0.1)
```

### TLS / HTTPS sin warnings (`https://miproyecto.test`)

Caddy en la MSI usa su CA interna para emitir los certificados `*.test`. Como el
navegador es el del **Mac**, hay que confiar en **esa** CA en el Mac:

```bash
# 1) Copia el root CA de Caddy desde la MSI al Mac
ssh msi-damp 'docker exec damp-caddy cat /data/caddy/pki/authorities/local/root.crt' > /tmp/damp-msi-root.crt

# 2) Confía en él en el llavero del sistema del Mac (TODO EN UNA SOLA LÍNEA)
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/damp-msi-root.crt
```

> Si pegas el comando partido con `\` y solo ves el "usage" de `add-trusted-cert`,
> es que se cortó: pégalo **en una sola línea**.

Verifica que el TLS valida (sin `-k`):

```bash
curl -s -o /dev/null -w "HTTP %{http_code} | tls_verify %{ssl_verify_result}\n" https://damp.test/
# Esperado: HTTP 200 | tls_verify 0
```

Reinicia el navegador. Si Chrome se queja por HSTS, limpia
`chrome://net-internals/#hsts`. (Repite el bloque si Caddy regenera su CA.)

---

## Fase 3 — Sync de código (Mutagen)

Instala Mutagen en el Mac:

```bash
brew install mutagen-io/mutagen/mutagen
```

> **Si el tap intenta compilar y falla** (p.ej. error de Command Line Tools de
> Xcode), usa el binario precompilado oficial — no necesita compilar ni sudo:
> ```bash
> cd /tmp
> curl -fsSL -o mutagen.tgz https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_darwin_arm64_v0.18.1.tar.gz
> tar xzf mutagen.tgz && mkdir -p ~/.local/bin && cp mutagen mutagen-agents.tar.gz ~/.local/bin/
> chmod +x ~/.local/bin/mutagen && mutagen version   # asegúrate que ~/.local/bin esté en PATH
> ```
> (Ajusta `darwin_arm64` / versión según tu Mac.)

Configura el proyecto a sincronizar. Copia la plantilla y edítala:

```bash
cp ~/sourcecode/damp/local-remote/mutagen.yml ~/sourcecode/mi-proyecto/mutagen.yml
```

Edita el bloque `sync.project` (o crea uno por proyecto):

```yaml
sync:
  miproyecto:
    alpha: "${HOME}/sourcecode/miproyecto"
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
2. SSH config: el `msi-damp` (host `IP-MSI`, puerto `22` con Tailscale o `2222` con portproxy, tu usuario+llave).
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
DAMP_REMOTE_PORT=22
EOF
```

> `DAMP_REMOTE_PORT=22` con Tailscale; usa `2222` solo si conectas por el
> portproxy de Windows. (Si tu `~/.ssh/config` ya define el `Port` del alias
> `msi-damp`, este valor es redundante pero no estorba.)

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

### Adoptar un proyecto nuevo en la MSI (receta completa, probada)

> **Atajo:** `damp-adopt <ruta-del-proyecto>` hace todos estos pasos
> automáticamente y es idempotente. Lee la receta de abajo si quieres entender
> qué ocurre o necesitas depurar un paso concreto.

Esta es la secuencia real que validamos con un proyecto CodeIgniter 4
(frankenphp). Sirve de plantilla para cualquier proyecto PHP. Sustituye
`miproyecto` por el nombre real.

> **Por qué hay pasos manuales:** Mutagen **no** sincroniza `vendor/`,
> `node_modules/` ni `writable/` (son pesados o de runtime). Por eso esas piezas
> se generan/crean **en la MSI**, no se copian por la red. La base de datos
> tampoco se sincroniza: se copia aparte (paso 6).

```bash
# ── 1. Sync del código a la MSI (desde el Mac) ─────────────────────
cd ~/sourcecode/miproyecto
cp ~/sourcecode/damp/local-remote/mutagen.yml ./mutagen.yml   # si no existe
# Edita el bloque sync con alpha (Mac) y beta (msi-damp:/home/USER/sourcecode/miproyecto)
echo "mutagen.yml" >> .gitignore
mutagen project start
mutagen sync list           # espera "Watching for changes"

# ── 2. Build + arranque del contenedor en la MSI ───────────────────
# OJO: la primera build de frankenphp tarda (compila extensiones PHP). Si tu
# shell tiene timeout, lánzalo en background en la MSI para que sobreviva:
ssh msi-damp 'cd ~/sourcecode/damp && nohup ./core/bin/damp start miproyecto > /tmp/miproyecto-start.log 2>&1 &'
ssh msi-damp 'tail -f /tmp/miproyecto-start.log'   # observa hasta "miproyecto is running"

# ── 3. Registrar el dominio en el Caddy GLOBAL ─────────────────────
# Si `damp start` no escribió el routing (proyecto ya inicializado en otra
# máquina), créalo a mano. El upstream = container_name del docker-compose
# del proyecto (frankenphp escucha en :80).
ssh msi-damp 'cat > ~/sourcecode/damp/core/caddy/projects.d/miproyecto.caddy <<EOF
miproyecto.test {
    reverse_proxy miproyecto:80
}
EOF'
ssh msi-damp 'cd ~/sourcecode/damp && ./core/bin/damp reload'

# ── 4. Dependencias (composer) DENTRO de la MSI ────────────────────
# El contenedor frankenphp no trae composer; usa la imagen oficial montando
# el código. --ignore-platform-req=ext-intl: la imagen composer no tiene intl,
# pero el contenedor frankenphp SÍ (ahí se ejecuta), así que es seguro ignorarlo.
ssh msi-damp 'docker run --rm -v ~/sourcecode/miproyecto:/app -w /app composer:2 \
  install --no-interaction --no-progress --ignore-platform-req=ext-intl'

# ── 5. Directorios de runtime (CI4 writable/) en el contenedor ─────
ssh msi-damp 'docker exec miproyecto sh -c "mkdir -p /app/writable/cache /app/writable/logs /app/writable/session /app/writable/uploads /app/writable/debugbar && chmod -R 777 /app/writable"'

# ── 6. Base de datos: copiarla del Mac (OrbStack) → damp-db de la MSI ─
# 6a. Crea DB + usuario en la MSI con las credenciales que espera el .env del
#     proyecto (database.default.{database,username,password}):
ssh msi-damp 'docker exec damp-db mysql -uroot -proot -e '\''CREATE DATABASE IF NOT EXISTS mi_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS "mi_user"@"%" IDENTIFIED BY "MI_PASS"; GRANT ALL PRIVILEGES ON mi_db.* TO "mi_user"@"%"; FLUSH PRIVILEGES;'\'''
# 6b. Dump de la base local (OrbStack en el Mac) y restauración en la MSI:
docker exec damp-db mysqldump -uroot -proot --single-transaction --no-tablespaces \
  --routines --triggers --events mi_db > /tmp/mi_db.sql
ssh msi-damp 'docker exec -i damp-db mysql -uroot -proot mi_db' < /tmp/mi_db.sql
#  (alternativa equivalente: damp-remote import mi_db /tmp/mi_db.sql)

# ── 7. Verifica desde el navegador del Mac ─────────────────────────
curl -sL -o /dev/null -w "HTTP %{http_code} | %{url_effective}\n" https://miproyecto.test/
open https://miproyecto.test
```

> **`damp init` interactivo:** si en vez de la receta de arriba prefieres el
> wizard, córrelo con TTY **después** del sync. Pero ojo: regenera
> `Dampfile`/`Dockerfile`/`Caddyfile` y pregunta "Overwrite all generated
> files?" — responde **n** si el proyecto ya trae los suyos.
> `ssh -t msi-damp 'cd ~/sourcecode/miproyecto && ~/sourcecode/damp/core/bin/damp init'`

#### Mapa de errores típicos al adoptar un proyecto

| Síntoma en `https://miproyecto.test` | Causa | Paso que lo arregla |
|---|---|---|
| `tlsv1 alert internal error` / `HTTP 000` | Caddy no tiene cert para ese dominio (no registrado / TLD viejo) | Paso 3 (registrar + reload) |
| `Failed opening required ... vendor/...` | Falta `vendor/` (no se sincroniza) | Paso 4 (composer) |
| `HTTP 503` | Falta `writable/` (CI4) o el contenedor no levanta | Paso 5 |
| `Unable to connect to the database / Access denied` | DB o usuario no existen en `damp-db` | Paso 6a |
| `Table '...' doesn't exist` | DB vacía (sin esquema/datos) | Paso 6b (copiar dump) |

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

> **No apagues OrbStack todavía si aún tienes bases de datos locales que migrar.**
> El `damp-db` de OrbStack en el Mac es la fuente del `mysqldump` para poblar la
> MSI (receta de adopción, paso 6). Apágalo cuando ya hayas copiado todo.

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
| Todo respondía y de pronto `HTTP 000` / timeouts intermitentes | **La MSI se durmió/hibernó** (Windows) | Despiértala/enchúfala; ver "Mantener la MSI despierta". Con Tailscale, `nc -z IP-MSI 22` confirma si está viva |
| `damp.test` da `tlsv1 alert internal error` pero `cualquier.test` no | Caddy corre con config vieja (p.ej. TLD `.local` de otra sesión) y no tiene cert para `.test` | `ssh msi-damp 'cd ~/sourcecode/damp && ./core/bin/damp reload'` para que tome el `.env` con `DAMP_TLD=test` |
| `dig @127.0.0.1 x.test` da `127.0.0.1` aunque `damp.conf` apunte a la MSI | dnsmasq lee `/etc/hosts` (prioridad) o no recargó | Añade `no-hosts` a `damp.conf` + comenta `/etc/hosts` + `sudo brew services restart dnsmasq` (ver Fase 2) |
| `damp-remote start` parece colgarse y luego no hay contenedor | El build era hijo de la sesión SSH y murió al cerrarse / timeout | Lánzalo con `nohup ... &` en la MSI (ver receta paso 2) |
| `add-trusted-cert` solo imprime su "usage" | Pegaste el comando partido con `\` | Pégalo en **una sola línea** |
| `cmd.exe`/`powershell.exe` no funcionan vía `ssh msi-damp` | Interop WSL→Windows deshabilitado | Aplica lo de PowerShell/`.wslconfig` **directamente en Windows**, no por SSH |

### Diagnóstico rápido de conectividad (desde el Mac)

```bash
nc -z -G 6 IP-MSI 22  && echo "SSH ok"      # ¿MSI viva?
nc -z -G 6 IP-MSI 80  && echo "HTTP ok"     # ¿Caddy escucha?
nc -z -G 6 IP-MSI 443 && echo "HTTPS ok"
ssh msi-damp 'docker ps --format "{{.Names}}: {{.Status}}"'   # ¿stack arriba?
curl -s -o /dev/null -w "%{http_code} %{ssl_verify_result}\n" https://damp.test/
```

---

## Archivos de este setup

- [`local-remote/setup-msi.sh`](setup-msi.sh) — bootstrap de la MSI (SSH, Docker, repo, `.env`).
- [`local-remote/setup-mac.sh`](setup-mac.sh) — onboarding del Mac (deps, SSH, DNS, TLS, `damp-remote`); `--check` para verificar.
- [`local-remote/damp-adopt`](damp-adopt) — adopta un proyecto en la MSI de punta a punta (sync, build, ruta Caddy, composer, `writable/`, DB). Idempotente.
- [`local-remote/setup-mac-dns.sh`](setup-mac-dns.sh) — repunta `*.test` del Mac a la MSI (y `--revert`).
- [`local-remote/mutagen.yml`](mutagen.yml) — plantilla de defaults de sync (las sesiones las genera `damp-adopt`).
- [`local-remote/damp-remote`](damp-remote) — ejecuta comandos `damp` en la MSI por SSH.

> **Portabilidad:** ninguno de estos scripts contiene rutas, usuarios, IPs ni
> credenciales fijas. Todo se detecta del entorno (`$HOME`, `whoami`,
> `brew --prefix`), se lee de config/`.env`, o se pregunta. Funcionan en
> cualquier Mac contra cualquier host DAMP remoto.
