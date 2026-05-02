# DAMP Issues & Improvements

Audit date: 2026-05-02

---

## Backend (Go)

### P0 — Data Loss / Corruption

| # | Issue | Location | Fix |
|---|---|---|---|
| B1 | **Race condition in registry**: `RegisterProject`, `RecordStartRequest`, `UnregisterProject` do load→modify→save on `registry.json` without any locking. Two concurrent HTTP requests = data loss (last write wins, earlier writes discarded). | `config.go:230-255` | Add `sync.Mutex` to `ConfigClient` or use atomic file writes |
| B2 | **No graceful shutdown**: `http.ListenAndServe` blocks with no signal handling (`SIGTERM`, `SIGINT`). On `docker stop`, the process terminates immediately — active `docker compose up` goroutines become orphaned, SSE connections killed mid-stream, registry file may corrupt mid-write. | `main.go:131` | Use `http.Server` with `Shutdown()`, listen for OS signals, drain in-flight requests |
| B3 | **`DeleteProject()` always returns nil error**: It swallows `os.Remove` (config file), `dbClient.DropDatabase`, and `reloadCaddy` failures. API always returns 200 even if nothing was actually deleted. | `config.go:519-571` | Propagate errors, return partial success info |
| B4 | **Errors swallowed with `_` can destroy the registry**: `loadRegistry()` errors are discarded. If the JSON file is corrupt, `Unmarshal` returns an empty slice and the subsequent `saveRegistry()` overwrites the corrupt file with empty data — all registered projects lost permanently. | `config.go:231,249,260,271,449` | Log errors, refuse to save if read failed |
| B5 | **`/api/status` lies about Docker**: `docker_running` is hardcoded to `true` regardless of whether Docker is actually reachable. If Docker is down, containers is `nil` (swallowed error) but status still reports running. | `docker.go:406` | Actually check Docker connectivity |
| B6 | **Errors in `HandleStatus` swallowed**: `ListContainers`, `ListDatabases`, and Postgres listing errors are all discarded with `_`. If MySQL is down, only PG databases show. If both are down, status is empty 200 OK. | `docker.go:400-402` | Report partial failures in the response |

### P1 — Stability & Consistency

| # | Issue | Location | Fix |
|---|---|---|---|
| B7 | **No panic recovery**: If any HTTP handler panics (nil pointer from a swallowed error), the entire server crashes. The `go func()` in `CreateProject` also has no recovery. | All handlers | Add `recover()` middleware, add defer+recover in goroutine |
| B8 | **CORS only on 3 of ~17 routes**: Only `/api/projects` (GET), `/api/containers/{name}/logs`, and `/api/events` set CORS headers. All other JSON endpoints lack `Access-Control-Allow-Origin`. | `main.go:102`, various | Apply CORS middleware to all API routes |
| B9 | **SSE data inconsistency**: SSE events use `ListContainers()` (filtered by `damp` Docker network), but `ListProjectsFromCaddy` uses `GetAllContainers()` (unfiltered). The overview page and projects page can show different container sets. | `docker.go:77` vs `docker.go:132` | Use same container source or reconcile |
| B10 | **Goroutine in `CreateProject` writes to `os.Stderr` without synchronization**: Multiple concurrent project creates will interleave stderr output. | `config.go:379-383` | Use a logger or channel |
| B11 | **`sendContainerStatus` error paths**: If `ListContainers` fails or `json.Marshal` fails, corrupt data is written to the SSE stream with no error indication to clients. | `docker.go:383-389` | Skip write on error, log the failure |
| B12 | **`StreamLogs` creates a new `http.Transport` every call**: No timeout set on the transport, leaks goroutines over time. | `docker.go:247-259` | Reuse the client's transport or set a timeout |

### P2 — Input Validation & Security

| # | Issue | Location | Fix |
|---|---|---|---|
| B13 | **`HandleProjectAction` does not validate project name format**: Unlike `HandleDeleteProject` which uses `validName` regex, start/stop/restart accepts any string from the URL path. | `docker.go:226` | Validate with `validName` |
| B14 | **`CreateProject` does not clean `projectPath`**: Only checks `filepath.IsAbs()`, not `filepath.Clean()` or `filepath.EvalSymlinks()`. A path like `/etc/../../tmp/../../var/www` passes. Symlinks could cause file writes outside intended directory. | `config.go:338` | Use `filepath.Clean` + `filepath.EvalSymlinks` |
| B15 | **`HandleBrowse` path traversal risk**: Uses `filepath.Clean` but not `filepath.EvalSymlinks`. A symlink inside `/Users` pointing to `/etc` could bypass prefix checks. | `config.go:723` | Resolve symlinks before prefix check |
| B16 | **Command injection via `addHostEntry` on Windows**: PowerShell command string is built with `fmt.Sprintf` using user-supplied domain name. Backticks or `$()` in the name could execute arbitrary code. | `config.go:642-670` | Escape or validate domain before interpolation |
| B17 | **Hardcoded default DB root password `"root"`**: Used when `DB_ROOT_PASSWORD` env var is not set. | `main.go:35` | Require the env var, refuse to start without it |
| B18 | **Password passed as CLI arg to `docker exec` for mysqldump**: `-p` + password concatenation. Special chars in password may cause unexpected behavior. | `database.go:126-131` | Use `MYSQL_PWD` env var or a config file |

### P3 — Code Quality

| # | Issue | Location | Fix |
|---|---|---|---|
| B19 | **`HandleProjects()` is dead code**: Defined in `config.go:59-70` but never registered in `main.go`. The inline handler at `main.go:89` replaces it. | `config.go:59` | Remove or register it |
| B20 | **`ListContainers` and `GetAllContainers` are 90% duplicate**: Same Docker API call, same JSON parsing, same struct. Only differs in network name filter. | `docker.go:77-159` | Refactor into one function with filter param |
| B21 | **10+ handlers repeat method checking**: `if r.Method != http.MethodGet` pattern duplicated everywhere. | Many handlers | Add a method-routing helper or middleware |
| B22 | **Mixed error response formats**: Some handlers use `jsonError()` (JSON), others use `http.Error()` (plain text). Clients expecting JSON break on plain text responses. | Various | Standardize on JSON errors |
| B23 | **No request logging middleware**: Zero visibility into request method, path, status code, latency. Debugging is nearly impossible. | All | Add logging middleware |
| B24 | **No rate limiting**: No protection against brute-force or excessive API calls. | All | Add rate limiter middleware |
| B25 | **SSE sends bare JSON without `event:` type**: Clients must introspect every message to determine its type. | `docker.go:388` | Add `event: container-status` etc. |
| B26 | **Hardcoded template descriptions**: Adding a new template requires a Go code change to the `templates` map. | `config.go:79-86` | Read template metadata from files (e.g., `template.json` per directory) |

---

## Frontend (JS/CSS/HTML)

### P0 — Critical

| # | Issue | Location | Fix |
|---|---|---|---|
| F1 | **`api()` helper has no HTTP error checking**: Does not check `res.ok`. A 500 error with HTML body causes a silent JSON parse error. | `app.js:90-93` | Check `res.ok`, throw on non-2xx |
| F2 | **Zero ARIA attributes across entire app**: No `role`, `aria-*`, `tabindex` anywhere. Cards used as buttons are not keyboard-accessible. Modal has no `role="dialog"`, no focus trapping, Escape key doesn't close it. | All files | Add ARIA roles, labels, keyboard handlers, focus management |
| F3 | **`--surface-alt` CSS variable used but never defined**: Used in 3 inline styles (`projects.js:132`, `databases.js:60,67`). Background resolves to invalid/unset — inconsistent or invisible backgrounds. | `projects.js`, `databases.js` | Define in `:root` or use existing variable |
| F4 | **Log SSE has zero reconnection logic**: Main SSE reconnects after 5s, but log SSE just closes on error and shows "Connection lost". User must manually re-select a container. | `logs.js:47-50` | Add reconnection with exponential backoff |
| F5 | **`.container-meta` CSS rule duplicated**: Defined at lines 446 and 461. Second definition overrides first, losing `font-family`, `text-transform`, `letter-spacing`. | `styles.css:446,461` | Remove duplicate, merge properties |

### P1 — High

| # | Issue | Location | Fix |
|---|---|---|---|
| F6 | **72 instances of inline `style=` attributes**: Colors, layouts, spacing hardcoded in JS instead of CSS classes. `projects.js` alone has 51. Makes theming/maintenance very difficult. | All JS view files | Extract to CSS classes |
| F7 | **Zero `@media` queries — no responsive design**: Sidebar is fixed 240px with no collapse/hamburger. Modal is fixed 500px. No mobile breakpoints anywhere. On phones, sidebar takes ~75% of viewport. | `styles.css` (1138 lines) | Add breakpoints, hamburger menu, responsive grid |
| F8 | **No confirmation for "Stop Engine"**: Stops all DAMP services immediately without any prompt. | `overview.js:94` | Add `confirm()` dialog |
| F9 | **Race condition with `logSource` global**: Rapid container switching can leave zombie SSE connections. `hashchange` handler and `renderLogs` both close `logSource` — potential double-close. | `logs.js:3,58` | Use a ref with proper lifecycle management |
| F10 | **Dozens of hardcoded English strings bypass i18n**: "Next Steps", "Select Folder", "Cancel", "Select this folder", "Please select a folder first", "Empty directory", "Project Preview", "Domain:", "Database:", tooltips, alert messages. | All JS views | Add to `i18n.js` translations |
| F11 | **Entire `.project-card` CSS component (124 lines) is dead code**: Fully styled card system that is never rendered — projects view uses `.container-row` instead. | `styles.css:847-970` | Remove dead CSS or switch projects view to use it |
| F12 | **`html[lang]` not updated on language switch**: Stays `"en"` even when user switches to Spanish. Screen readers get wrong language info. | `i18n.js:138` | Update `document.documentElement.lang` on switch |
| F13 | **No `AbortController` on most fetches**: Only `adoptProject()` has one. If user navigates away, pending requests still complete and try to update now-absent DOM elements. | All views | Add abort on navigation/component unmount |

### P2 — Medium

| # | Issue | Location | Fix |
|---|---|---|---|
| F14 | **`innerHTML` replaces entire DOM on every render**: Destroys all nodes, loses scroll position, focus, and transient state. SSE updates cause full `innerHTML` replacement of `#container-list`. | All view files | Use targeted DOM updates or diffing |
| F15 | **No form validation feedback**: Invalid characters silently stripped. No max length checks. No duplicate name checks. No visual error states on inputs (red border, error message). | `projects.js`, `databases.js` | Add HTML5 validation attributes + visual error states |
| F16 | **`catch (e) {}` empty in SSE `onmessage` handler**: JSON parse errors silently ignored — UI shows stale data with no indication. | `app.js:47` | Log error, show stale-data indicator |
| F17 | **Font sizes too small for mobile**: 10-13px across the board. iOS Safari will zoom on form inputs with font-size < 16px. | `styles.css` | Increase minimum font sizes, especially for form elements |
| F18 | **Database stats become stale after create/drop**: `refreshAllDatabases()` only updates cards, not the stats counters at top of page. | `databases.js` | Refresh stats together with card list |
| F19 | **Templates grid has no "selected" visual feedback**: `selectTemplate()` sets the dropdown but template cards don't highlight. | `projects.js:155-159` | Add `.active` class to selected template card |
| F20 | **SSE reconnection uses fixed 5s delay**: No exponential backoff. On persistent failures, retries every 5s forever. | `app.js:49` | Implement exponential backoff with jitter |
| F21 | **`fade-in` and stagger animations replay on every render**: Even during SSE incremental updates, all items re-animate causing visual jitter. | `styles.css` | Only animate on first render, not updates |
| F22 | **Button styling inconsistency**: Some use `.btn-icon`, some use `.btn.btn-sm`, some use inline styles. Destructive actions inconsistent — delete project has confirm, stop engine has none, stop container has none. | All views | Standardize button classes and confirmation patterns |

### P3 — Low

| # | Issue | Location | Fix |
|---|---|---|---|
| F23 | **No loading states on many actions**: Container start/stop, project start/stop, engine start/stop, database create/drop show no loading feedback. Buttons stay clickable during async operations. | All views | Add loading spinners and disabled states |
| F24 | **Color contrast below WCAG AA**: `.text-muted` (#606070) on `--bg` (#0a0a0f) has ~3.9:1 ratio. Minimum for normal text is 4.5:1. | `styles.css` | Lighten muted text or validate contrast |
| F25 | **Six different pseudo-element decoration patterns**: `::after` gradients on sidebar/topbar, `::before` sliding/accent borders on cards — no shared approach. | `styles.css` | Consolidate decorative pseudo-elements |
| F26 | **No `event:` type on SSE log stream**: Same issue as backend — clients must parse unknown data format. | `logs.js` | Add event type headers |
| F27 | **Missing empty states**: Templates section (empty array = blank), logs dropdown (no containers = unhelpful), services grid (no guard for empty). | Various | Add empty state messages for all sections |
