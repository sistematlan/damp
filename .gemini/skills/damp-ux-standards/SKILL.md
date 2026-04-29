---
name: damp-ux-standards
description: Guías de diseño y estándares UX/UI para el ecosistema DAMP (Dashboard y CLI). Asegura una estética "developer-first", minimalista y técnica.
---

# DAMP UX/UI Standards

Este skill define cómo deben evolucionar las interfaces de DAMP para mantener una experiencia coherente, técnica y eficiente.

## Principios de Diseño

1. **Terminal-Native Aesthetic**: El dashboard no es una webapp genérica; es una extensión de las herramientas de consola.
   - Usa fuentes mono (`SF Mono`, `Fira Code`) para datos técnicos.
   - Colores oscuros profundos (`#0a0a0f`) con acentos neón controlados.
2. **Densidad de Información**: Los desarrolladores prefieren ver más datos de un vistazo que espacios en blanco innecesarios.
   - Cards compactas.
   - Listas densas pero legibles.
3. **Feedback Inmediato**: Cada acción (start, stop, delete) debe mostrar un estado visual instantáneo (skeletons, spinners o estados optimistas).

## Componentes y Estilos

### Colores
- **Fondo**: `#0a0a0f`
- **Superficie**: `#12121a`
- **Acento**: `#6366f1` (Indigo)
- **Éxito**: `#10b981` (Emerald)
- **Peligro**: `#ef4444` (Rose)

### Layout
- **Sidebar**: 220px, fija, con indicador de salud global.
- **Content**: Grid dinámico (1, 2 o 3 columnas según el tamaño de pantalla).

## Workflows UX

### Gestión de Proyectos
- Siempre mostrar el **Template** (ej. FrankenPHP) de forma prominente.
- Botones de acción rápida: `Browser`, `Editor`, `Terminal`.

### Logs
- Deben ser **Streaming (SSE)** por defecto.
- Autoscroll inteligente: seguid el scroll si el usuario está al final, pausadlo si el usuario sube para leer.

### Bases de Datos
- Agrupación por motor (MySQL vs Postgres).
- Confirmación destructiva de dos pasos para `Drop Database`.

## Referencias
- Ver `core/dashboard/web/css/styles.css` para la implementación base.
