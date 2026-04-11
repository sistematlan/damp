# DAMP Project Backlog

## 🟢 Completado hoy
- [x] **Aislamiento del Core:** Motor movido a `core/`, separado de los proyectos.
- [x] **Registro Global:** Persistencia en `~/.damp/projects.json`.
- [x] **UI/UX:** Interfaz "Terminal-Luxe" con Sidebar y diseño Bento.
- [x] **Adopción Zero-Config:** Selector de carpetas nativo y auto-configuración de Caddy/DNS.
- [x] **SSL/DNS:** Scripts de `trust` y `setup-dns` funcionando.

## 🟡 Pendiente Prioritario
- [x] **Restauración de DB:** Resuelto — v1/v2 recuperadas desde dump remoto (2026-04-11). Raíz: volumen `core_mysql_data` efímero frente a rebuilds.
- [ ] **Persistencia de datos:** Mover `mysql_data`/`postgres_data`/`caddy_data` a bind-mounts (`./data/`) para sobrevivir `docker compose down -v`.
- [ ] **Comando `./damp backup` / `./damp restore`:** Dumps automatizados de todas las DBs a `./data/backups/YYYY-MM-DD/`.
- [ ] **Detector de Conflictos:** Alerta de puertos ocupados al iniciar el motor.
- [ ] **Logs en Tiempo Real:** Integrar visor de logs en la App Desktop.

## 🔵 Futuro / Publishing
- [ ] **Bundling:** Incluir `core/` dentro de los recursos de la App Tauri.
- [ ] **Templates Pro:** Añadir Laravel, Astro y WordPress optimizado.
- [ ] **Multi-plataforma:** Probar instaladores en Windows (WSL2) y Linux.
