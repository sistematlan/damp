# DAMP Desktop GUI — Backlog

> Última actualización: 2026-04-27
> Sesión anterior: Análisis profundo Dashboard Web vs Desktop + Fixes Windows

---

## ✅ Hecho en esta sesión

### Fixes Windows aplicados a `app/src-tauri/src/lib.rs`

1. **`get_docker_path()`** — Ahora detecta `docker.exe` en rutas de Docker Desktop para Windows (`C:\Program Files\Docker\Docker\resources\bin\`) y fallback a PATH. Usa `#[cfg(target_os = "windows")]`.

2. **`is_docker_desktop_installed()`** — Nueva función cross-platform reemplazando `orbstack_installed`:
   - macOS: detecta `Docker.app` y `OrbStack.app`
   - Windows: detecta `Docker Desktop.exe`
   - Linux: verifica si `docker` está en PATH

3. **`create_project`** — Eliminada dependencia de `bash` + script `damp`. Ahora replica la lógica directamente en Rust (copia template, reemplaza `PROJECT_NAME`, crea DB, genera Caddy config, recarga Caddy, inicia contenedores). Funciona en Windows nativo.

4. **`delete_project`** — Eliminada dependencia de `bash damp reload`. Ahora usa `docker compose up -d caddy --force-recreate` directamente.

5. **`adopt_project`** — Eliminada dependencia de `bash damp reload`. Mismo fix que arriba.

6. **`open_url`** — En Windows usa `cmd /c start "" <url>` en lugar de `explorer`, más confiable para HTTPS.

7. **`resolve_damp_path()`** — No requirió cambios (ya usa `DAMP_PATH` env var como override).

### Otros cambios

- `tauri.conf.json`: Window size aumentado a 1200x800 (mínimo 900x600)
- `types.ts`: Actualizado `orbstack_installed` → `docker_desktop_installed`

### Builds verificados

- [x] Rust compila sin errores (`cargo check`)
- [x] TypeScript compila sin errores (`tsc --noEmit`)
- [x] Frontend build exitoso (`vite build`)

---

## 📋 Backlog — Próxima sesión

### 🔥 P0: Unificación Desktop ↔ Dashboard Web (Opción A recomendada)

**Objetivo:** La app Tauri debe funcionar como un cliente del API HTTP Go del dashboard web, en lugar de reimplementar la lógica en Rust. Esto elimina la duplicación de código y garantiza paridad 100%.

**Motivación:**
- El dashboard web tiene features que el desktop NO tiene (backup de DB, SSE logs, preview de proyecto, templates gallery)
- Cada bug/feature requiere implementación doble (Go + Rust)
- El backend Go ya está compilado y funciona en Linux (`damp-dashboard-linux`)

**Tareas técnicas:**

- [ ] Compilar `damp-dashboard` para Windows y macOS
  - Windows: `GOOS=windows GOARCH=amd64 go build -o damp-dashboard.exe`
  - macOS: ya existe binario nativo
  - Linux: ya existe `damp-dashboard-linux`

- [ ] Empaquetar el binario Go con la app Tauri
  - En `tauri.conf.json` o en el build script, copiar el binario al bundle
  - El binario debe ejecutarse en background al iniciar la app (puerto 9000)

- [ ] Crear wrapper en Rust para lanzar/detener el backend Go
  ```rust
  // Al iniciar la app
  fn start_dashboard_backend() -> Child {
      Command::new(sidecar_binary)
          .env("DAMP_DIR", damp_path)
          .env("DASHBOARD_PORT", "9000")
          .spawn()
  }
  // Al cerrar la app
  fn stop_dashboard_backend(child: &mut Child) {
      child.kill().ok();
  }
  ```

- [ ] Reemplazar Tauri commands (`get_status`, `damp_up`, etc.) por llamadas HTTP a `localhost:9000`
  - Usar `reqwest` o `ureq` en Rust para hacer fetch al API
  - Transformar la respuesta JSON al tipo Rust correspondiente
  - Eliminar toda la lógica duplicada de Docker/DB/Caddy del Rust

- [ ] Frontend React: mantener como está (ya usa `invoke`, se puede migrar a `fetch` si es necesario)

**Archivos a tocar:**
- `app/src-tauri/src/lib.rs` — Reescritura mayor
- `app/src-tauri/Cargo.toml` — Agregar `reqwest` o `ureq`
- `app/src-tauri/tauri.conf.json` — Configurar sidecar

---

### 🔥 P0: Backup de DB antes de eliminar proyecto (Desktop)

**Contexto:** El dashboard web hace `mysqldump` antes de `DROP DATABASE`. El desktop hace drop directo.

**Implementación en Rust actual (si no se hace la unificación):**
```rust
fn delete_project(path: String) -> Result<String, String> {
    // Antes del drop, hacer backup:
    let dump_file = format!("{}_db_dump_{}.sql", name, timestamp);
    let _ = Command::new(&docker_bin)
        .args(["exec", "damp-db", "mysqldump", "-uroot", "-proot", &db_name])
        .stdout(std::fs::File::create(&dump_file)?)
        .output();
    // ... luego el drop
}
```

**Si se hace la unificación:** Viene gratis del API Go.

---

### 🟡 P1: Streaming de logs real (SSE)

**Contexto:** El dashboard web usa `EventSource` con SSE para logs en tiempo real. El desktop hace polling cada 2 segundos.

**Opciones:**
1. Migrar a API Go (SSE ya funciona en `/api/containers/{name}/logs`)
2. Implementar SSE en Tauri con un thread que lea `docker logs -f` y emita eventos

**Archivos:** `app/src/components/Logs.tsx`, `app/src-tauri/src/lib.rs`

---

### 🟡 P1: Templates gallery con descripciones

**Contexto:** El dashboard web muestra cards de templates con descripciones. El desktop solo muestra un `<select>` con nombres.

**Archivos:** `app/src/components/Projects.tsx`

---

### 🟡 P1: Project preview al adoptar

**Contexto:** El dashboard web muestra preview (domain, DB name, containers, proxy target). El desktop no.

**Archivos:** `app/src/components/Projects.tsx`

---

### 🟡 P2: Agregar damp-dashboard y damp-dns al service grid

**Contexto:** El dashboard web muestra 8 servicios incluyendo `damp-dashboard` y `damp-dns`. El desktop solo muestra 6.

**Archivos:** `app/src/components/Overview.tsx`

---

### 🟡 P2: Menú nativo de aplicación (Windows/Linux)

**Contexto:** Windows y Linux esperan un menú estándar (File, Edit, View). Solo hay tray icon.

**Archivos:** `app/src-tauri/src/lib.rs` (en el `setup` de Tauri)

---

## 🧠 Notas técnicas para la siguiente sesión

### Decisiones pendientes

1. **¿Unificación (Opción A) o seguir con Rust puro?**
   - Unificación = menos código, paridad garantizada, más fácil de mantener
   - Rust puro = app 100% offline sin servidor HTTP local, pero más trabajo

2. **¿Sidecar o proceso separado?**
   - Sidecar Tauri: el binario Go va empaquetado dentro del .app/.exe
   - Proceso separado: el usuario necesita tener DAMP instalado previamente

3. **¿Qué pasa si el puerto 9000 está ocupado?**
   - El backend Go ya soporta `DASHBOARD_PORT` env var
   - Hay que detectar puerto libre y pasárselo

### Contexto del sistema que hay que recordar

- El dashboard web es un **SPA Vanilla JS** servido por un **backend Go HTTP** que corre dentro del contenedor `damp-dashboard` (o standalone)
- El backend Go tiene acceso directo a:
  - Docker socket (`/var/run/docker.sock`) para containers
  - MySQL/PostgreSQL vía TCP para databases
  - Redis vía TCP
  - Filesystem del host para projects, Caddy configs, templates
- La app desktop Tauri corre **en el host** (no en Docker), así que tiene acceso diferente:
  - Docker vía CLI (cross-platform ahora ✅)
  - Bases de datos vía `docker exec` (cross-platform ahora ✅)
  - Redis vía `localhost:6379` (puede variar en Docker Desktop Windows/Mac)
  - Filesystem nativo

### Estructura de archivos relevantes

```
damp/
├── core/
│   ├── dashboard/
│   │   ├── main.go              ← Backend HTTP (Go)
│   │   ├── internal/
│   │   │   ├── docker.go        ← Docker API client
│   │   │   ├── database.go      ← MySQL/PostgreSQL/Redis clients
│   │   │   └── config.go        ← Projects, templates, Caddy
│   │   └── web/                 ← SPA Vanilla JS (dashboard web)
│   ├── bin/
│   │   └── damp                 ← Script principal (bash)
│   └── docker-compose.yml
│
├── app/                         ← Desktop GUI (Tauri)
│   ├── src/
│   │   ├── App.tsx              ← Main layout
│   │   ├── components/
│   │   │   ├── Overview.tsx
│   │   │   ├── Projects.tsx
│   │   │   ├── Databases.tsx
│   │   │   └── Logs.tsx
│   │   ├── types.ts             ← Tipos compartidos
│   │   └── styles.css           ← Estilos desktop
│   └── src-tauri/
│       ├── src/
│       │   └── lib.rs           ← Backend Rust (con fixes Windows)
│       ├── Cargo.toml
│       └── tauri.conf.json
│
└── BACKLOG.md                   ← Este archivo
```

---

## 📎 Referencias de la sesión anterior

- Análisis completo de paridad Web vs Desktop (108 líneas de código analizadas por vista)
- 5 gaps críticos identificados en el desktop
- 7 problemas cross-platform encontrados y solucionados
- Builds verificados: Rust ✅ TypeScript ✅ Vite ✅
