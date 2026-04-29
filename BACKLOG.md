# DAMP Desktop GUI — Backlog

> Última actualización: 2026-04-27
> Sesión anterior: Análisis profundo Dashboard Web vs Desktop + Fixes Windows

---

## ✅ Hecho en esta sesión

### Unificación Desktop ↔ Dashboard Web (P0)

1. **Sidecars Multi-plataforma** — Binarios Go compilados para Windows (x64), macOS (x64/arm64) y Linux (x64). Ubicados en `app/src-tauri/bin/`.
2. **Comunicación HTTP** — Todos los comandos Tauri (`get_status`, `create_project`, `delete_project`, etc.) ahora consumen el API del backend Go en `localhost:9000`.
3. **Backup Automático** — Al eliminar un proyecto desde la app desktop, ahora se genera un dump de la base de datos gracias a la lógica del backend Go.
4. **Logs en Tiempo Real (SSE)** — Migrado el componente `Logs.tsx` de polling a `EventSource`. Streaming nativo desde el backend Go.

### Mejoras UI/UX

1. **Templates Gallery con Descripciones** — Ahora se muestran cards con descripción para cada template en lugar de un simple select.
2. **Project Preview al Adoptar** — Se muestra la ruta y los archivos detectados antes de confirmar la adopción de una carpeta.
3. **Service Grid Actualizado** — Se agregó `damp-dashboard` al grid de servicios en el Overview.

---

## 📋 Backlog — Próxima sesión

### 🟡 P1: Menú nativo de aplicación (Windows/Linux)

**Contexto:** Windows y Linux esperan un menú estándar (File, Edit, View). Solo hay tray icon.
**Tareas:**
- [ ] Implementar `tauri::menu::Menu` en `lib.rs`.
- [ ] Agregar acciones comunes (Check for Updates, Reload, Toggle DevTools).

### 🟡 P2: Agregar damp-dns al service grid (opcional)

**Contexto:** El servicio DNS nativo (dnsmasq) no aparece en el grid porque no es un contenedor.
**Tareas:**
- [ ] Detectar si el servicio `dnsmasq` o similar está activo en el host y mostrarlo.

---

## ✅ Hecho en la sesión anterior (2026-04-27)

### Fixes Windows aplicados a `app/src-tauri/src/lib.rs`
... (resto del contenido anterior) ...

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
