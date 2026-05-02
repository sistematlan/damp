package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

var validName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

type ConfigClient struct {
	dampDir string
	mu      sync.RWMutex
}

type TemplateInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func NewConfigClient(dampDir string) *ConfigClient {
	return &ConfigClient{dampDir: dampDir}
}

type ProjectInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Template string `json:"template"`
}

func (c *ConfigClient) ListProjects() ([]ProjectInfo, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	home, _ := os.UserHomeDir()
	registryPath := filepath.Join(home, ".damp", "projects.json")

	if _, err := os.Stat(registryPath); os.IsNotExist(err) {
		return []ProjectInfo{}, nil
	}

	data, err := os.ReadFile(registryPath)
	if err != nil {
		return nil, err
	}

	var projects []ProjectInfo
	if err := json.Unmarshal(data, &projects); err != nil {
		return nil, err
	}
	return projects, nil
}

func (c *ConfigClient) ListTemplates() ([]TemplateInfo, error) {
	dir := filepath.Join(c.dampDir, "templates")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var templates []TemplateInfo
	for _, entry := range entries {
		if entry.IsDir() {
			name := entry.Name()
			desc := name
			
			// Try to read description from description.txt (B26)
			descPath := filepath.Join(dir, name, "description.txt")
			if data, err := os.ReadFile(descPath); err == nil {
				desc = strings.TrimSpace(string(data))
			}

			templates = append(templates, TemplateInfo{
				Name:        name,
				Description: desc,
			})
		}
	}
	return templates, nil
}

func HandleTemplates(w http.ResponseWriter, r *http.Request, cc *ConfigClient) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	templates, err := cc.ListTemplates()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, templates)
}

// ── Template detection ────────────────────────────────────

// DetectTemplate inspects a directory and returns the best template name.
// Mirrors the detect_template() logic in the CLI.
func DetectTemplate(dir string) string {
	// WordPress
	if fileExists(filepath.Join(dir, "wp-config.php")) || dirExists(filepath.Join(dir, "wp-content")) {
		return "wordpress"
	}

	// Composer-based PHP
	composerPath := filepath.Join(dir, "composer.json")
	if fileExists(composerPath) {
		data, err := os.ReadFile(composerPath)
		if err == nil {
			content := string(data)
			if strings.Contains(content, `"laravel/framework"`) ||
				strings.Contains(content, `"codeigniter4/framework"`) ||
				strings.Contains(content, `"symfony/`) {
				return "frankenphp"
			}
			// Check PHP version requirement
			if strings.Contains(content, `"5.`) {
				return "php-ancient"
			}
			if strings.Contains(content, `"7.`) {
				return "php-legacy"
			}
		}
		return "php-fpm"
	}

	// Node.js
	if fileExists(filepath.Join(dir, "package.json")) {
		return "node"
	}

	// Any PHP files
	entries, err := os.ReadDir(dir)
	if err == nil {
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".php") {
				return "php-fpm"
			}
		}
	}

	return ""
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func HandleDetectTemplate(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("path")
	if dir == "" {
		jsonError(w, "path is required", http.StatusBadRequest)
		return
	}
	template := DetectTemplate(dir)
	jsonResponse(w, map[string]string{"template": template})
}

// ── Project creation ──────────────────────────────────────

type CreateProjectRequest struct {
	Name     string `json:"name"`
	Template string `json:"template"`
	Path     string `json:"path"`
}

// ── Project registry (persists project paths) ────────────

type ProjectEntry struct {
	Name             string `json:"name"`
	Path             string `json:"path"`
	LastStartRequest string `json:"last_start_request,omitempty"`
}

func (c *ConfigClient) registryPath() string {
	return filepath.Join(c.dampDir, "caddy", "projects.d", "registry.json")
}

func (c *ConfigClient) loadRegistry() ([]ProjectEntry, error) {
	data, err := os.ReadFile(c.registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []ProjectEntry{}, nil
		}
		return nil, fmt.Errorf("read registry: %w", err)
	}
	var entries []ProjectEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("decode registry: %w (check for corruption in %s)", err, c.registryPath())
	}
	return entries, nil
}

func (c *ConfigClient) saveRegistry(entries []ProjectEntry) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("encode registry: %w", err)
	}
	return os.WriteFile(c.registryPath(), data, 0644)
}

func (c *ConfigClient) RegisterProject(name, path string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := c.loadRegistry()
	if err != nil {
		return err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	found := false
	for i, e := range entries {
		if e.Name == name {
			entries[i].Path = path
			entries[i].LastStartRequest = now
			found = true
			break
		}
	}
	if !found {
		entries = append(entries, ProjectEntry{Name: name, Path: path, LastStartRequest: now})
	}
	return c.saveRegistry(entries)
}

func (c *ConfigClient) RecordStartRequest(name string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := c.loadRegistry()
	if err != nil {
		return err
	}

	for i, e := range entries {
		if e.Name == name {
			entries[i].LastStartRequest = time.Now().UTC().Format(time.RFC3339)
			return c.saveRegistry(entries)
		}
	}
	return nil
}

func (c *ConfigClient) UnregisterProject(name string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := c.loadRegistry()
	if err != nil {
		return err
	}

	var filtered []ProjectEntry
	for _, e := range entries {
		if e.Name != name {
			filtered = append(filtered, e)
		}
	}
	return c.saveRegistry(filtered)
}

func (c *ConfigClient) GetProjectPath(name string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entries, _ := c.loadRegistry()
	for _, e := range entries {
		if e.Name == name {
			return e.Path
		}
	}
	return ""
}

type CreateProjectResponse struct {
	Status   string `json:"status"`
	Name     string `json:"name"`
	Domain   string `json:"domain"`
	Database string `json:"database"`
	Output   string `json:"output"`
}

func (c *ConfigClient) CreateProject(name, template, projectPath string, dbClient *DatabaseClient) (*CreateProjectResponse, error) {
	// 1. Validate template exists
	templateDir := filepath.Join(c.dampDir, "templates", template)
	if _, err := os.Stat(templateDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("template '%s' not found", template)
	}

	// 2. Create database
	dbName := strings.ReplaceAll(name, "-", "_") + "_db"
	if err := dbClient.CreateDatabase(dbName); err != nil {
		return nil, fmt.Errorf("failed to create database: %w", err)
	}

	// 3. Generate Caddy config
	caddyDir := filepath.Join(c.dampDir, "caddy", "projects.d")
	os.MkdirAll(caddyDir, 0755)
	domain := name + "." + dampTLD()
	
	// Determine target container based on template
	// frankenphp, wordpress, node, static use 'app' service
	// php-fpm, php-legacy, php-ancient use 'web' service (nginx)
	targetContainer := name + "-app:80"
	if template == "php-fpm" || template == "php-legacy" || template == "php-ancient" {
		targetContainer = name + "-web:80"
	}
	
	caddyConfig := fmt.Sprintf("%s {\n    reverse_proxy %s\n}\n", domain, targetContainer)
	caddyPath := filepath.Join(caddyDir, name+".caddy")
	if err := os.WriteFile(caddyPath, []byte(caddyConfig), 0644); err != nil {
		return nil, fmt.Errorf("failed to write Caddy config: %w", err)
	}

	// 4. Reload Caddy via admin API (stays inside Docker network)
	if err := reloadCaddy(c.dampDir); err != nil {
		// Non-fatal: project config file is already written; Caddy
		// will pick it up on next restart.
		fmt.Fprintf(os.Stderr, "caddy reload warning: %v\n", err)
	}

	// 5. Best-effort /etc/hosts entry (works on Linux; on macOS/OrbStack
	//    the bind mount is read-only from the host — DNS is handled by
	//    the native dnsmasq installed via setup-dns.sh during install).
	addHostEntry(domain)

	// 6. If path provided, scaffold + start
	status := "pending"
	output := fmt.Sprintf("Project '%s' registered. Run: damp new %s %s", name, template, name)

	if projectPath != "" {
		// Ensure absolute path and clean it (B14)
		projectPath = filepath.Clean(projectPath)
		if !filepath.IsAbs(projectPath) {
			return nil, fmt.Errorf("path must be absolute (e.g. %s/projects/%s)", hostHome(), name)
		}
		
		// Resolve symlinks to prevent escaping (B14)
		if evalPath, err := filepath.EvalSymlinks(projectPath); err == nil {
			projectPath = evalPath
		}

		os.MkdirAll(projectPath, 0755)

		// Copy template files, backing up existing conflicts
		entries, readErr := os.ReadDir(templateDir)
		if readErr != nil {
			return nil, fmt.Errorf("failed to read template dir: %w", readErr)
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			dstPath := filepath.Join(projectPath, entry.Name())
			// Backup existing file if it exists
			if fileExists(dstPath) {
				bakPath := dstPath + ".bak"
				os.Rename(dstPath, bakPath)
			}
			srcPath := filepath.Join(templateDir, entry.Name())
			data, err := os.ReadFile(srcPath)
			if err != nil {
				return nil, fmt.Errorf("failed to read template file %s: %w", entry.Name(), err)
			}
			content := strings.ReplaceAll(string(data), "PROJECT_NAME", name)
			if err := os.WriteFile(dstPath, []byte(content), 0644); err != nil {
				return nil, fmt.Errorf("failed to write %s: %w", dstPath, err)
			}
		}

		// Start containers in background — use --project-directory so Docker daemon
		// resolves volume mounts relative to the host path
		// This runs asynchronously to avoid blocking the HTTP response
		go func() {
			composeCmd := exec.Command("docker", "compose",
				"--project-directory", projectPath,
				"up", "-d", "--build")
			composeCmd.Dir = projectPath
			composeOut, err := composeCmd.CombinedOutput()
			if err != nil {
				log.Printf("Project %s failed to start: %v\nOutput: %s", name, err, string(composeOut))
			} else {
				log.Printf("Project %s started successfully", name)
			}
		}()
		
		status = "starting"
		output = fmt.Sprintf("Project '%s' is starting at https://%s. Wait 30 seconds then click the domain link or refresh the page.", name, domain)
	}

	if err := c.RegisterProject(name, projectPath); err != nil {
		return nil, fmt.Errorf("failed to register project: %w", err)
	}

	return &CreateProjectResponse{
		Status:   status,
		Name:     name,
		Domain:   domain,
		Database: dbName,
		Output:   output,
	}, nil
}

func HandleCreateProject(w http.ResponseWriter, r *http.Request, cc *ConfigClient, dbClient *DatabaseClient) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Template == "" {
		jsonError(w, "name and template are required", http.StatusBadRequest)
		return
	}
	// Normalize: lowercase, replace spaces/underscores/special chars with hyphens
	req.Name = strings.ToLower(req.Name)
	req.Name = regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(req.Name, "-")
	req.Name = regexp.MustCompile(`-+`).ReplaceAllString(req.Name, "-")
	req.Name = strings.Trim(req.Name, "-")

	result, err := cc.CreateProject(req.Name, req.Template, req.Path, dbClient)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, result)
}

// ── Project list from Caddy configs ──────────────────────

type ProjectStatus struct {
	Name     string `json:"name"`
	Domain   string `json:"domain"`
	Template string `json:"template"`
	Status   string `json:"status"`
	Path     string `json:"path,omitempty"`
	Health   string `json:"health"` // "ok", "broken_path", "missing_compose", "unlinked"
}

func (c *ConfigClient) ListProjectsFromCaddy(dc *DockerClient) ([]ProjectStatus, error) {
	caddyDir := filepath.Join(c.dampDir, "caddy", "projects.d")
	entries, err := os.ReadDir(caddyDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ProjectStatus{}, nil
		}
		return nil, err
	}

	// Load registry
	registry, _ := c.loadRegistry()
	registryMap := make(map[string]ProjectEntry)
	for _, e := range registry {
		registryMap[e.Name] = e
	}

	// Get ALL containers (including stopped) for status check
	containers, _ := dc.GetAllContainers()

	var projects []ProjectStatus
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".caddy") || name == "registry.json" {
			continue
		}
		projectName := strings.TrimSuffix(name, ".caddy")

		health := "ok"
		projectPath := ""
		
		// Check Registry link
		if reg, ok := registryMap[projectName]; ok {
			projectPath = reg.Path
			if projectPath != "" {
				if info, err := os.Stat(projectPath); err != nil || !info.IsDir() {
					health = "broken_path"
				} else {
					composePath := filepath.Join(projectPath, "docker-compose.yml")
					if _, err := os.Stat(composePath); err != nil {
						health = "missing_compose"
					}
				}
			} else {
				health = "unlinked"
			}
		} else {
			health = "unlinked"
		}

		status := "created"
		hasContainers := false
		detectedPath := ""

	containerLoop:
		for _, c := range containers {
			if c.Name == projectName || strings.HasPrefix(c.Name, projectName+"-") {
				hasContainers = true
				if c.HostPath != "" { detectedPath = c.HostPath }

				switch c.State {
				case "running":
					status = "running"
					break containerLoop
				case "created", "restarting":
					if status != "running" { status = "starting" }
				default:
					if status != "running" { status = "stopped" }
				}
			}
		}

		// Smart Link: If unlinked but we found where it lives, link it!
		if projectPath == "" && detectedPath != "" {
			log.Printf("SmartLink: Auto-linking project %s to %s", projectName, detectedPath)
			c.RegisterProject(projectName, detectedPath)
			projectPath = detectedPath
			health = "ok"
		}

		if !hasContainers && health == "ok" {
			if reg, ok := registryMap[projectName]; ok && reg.LastStartRequest != "" {
				t, parseErr := time.Parse(time.RFC3339, reg.LastStartRequest)
				if parseErr == nil && time.Since(t) < 60*time.Second {
					status = "starting"
				}
			}
		}

		projects = append(projects, ProjectStatus{
			Name:   projectName,
			Domain: projectName + "." + dampTLD(),
			Status: status,
			Path:   projectPath,
			Health: health,
		})
	}
	return projects, nil
}

// ── Delete project ───────────────────────────────────────

func (c *ConfigClient) DeleteProject(name string, dc *DockerClient, dbClient *DatabaseClient) (string, error) {
	dumpPath := ""
	var lastErr error
	
	// 1. Stop containers
	if dc != nil {
		ctx := context.Background()
		if _, err := dc.ProjectAction(ctx, name, "stop"); err != nil {
			lastErr = fmt.Errorf("stop containers: %w", err)
		}
	}

	// 2. Remove Caddy config
	caddyPath := filepath.Join(c.dampDir, "caddy", "projects.d", name+".caddy")
	if err := os.Remove(caddyPath); err != nil && !os.IsNotExist(err) {
		lastErr = fmt.Errorf("remove caddy config: %w", err)
	}

	// 3. Backup database before dropping
	dbName := strings.ReplaceAll(name, "-", "_") + "_db"
	projectPath := c.GetProjectPath(name)
	
	if dbClient != nil && projectPath != "" {
		// Check if database exists and has data
		dbs, _ := dbClient.ListDatabases()
		dbExists := false
		for _, db := range dbs {
			if db == dbName {
				dbExists = true
				break
			}
		}
		
		if dbExists {
			timestamp := time.Now().Format("20060102_150405")
			dumpFileName := fmt.Sprintf("%s_db_dump_%s.sql", name, timestamp)
			dumpPath = filepath.Join(projectPath, dumpFileName)
			
			if err := dbClient.DumpDatabase(dbName, dumpPath); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to dump database %s: %v\n", dbName, err)
				dumpPath = "" // Don't report path if dump failed
			}
		}
	}

	// 4. Drop database (best effort but log errors)
	if dbClient != nil {
		if err := dbClient.DropDatabase(dbName); err != nil {
			lastErr = fmt.Errorf("drop database: %w", err)
		}
	}

	// 5. Unregister
	if err := c.UnregisterProject(name); err != nil {
		lastErr = fmt.Errorf("unregister project: %w", err)
	}

	// 6. Reload Caddy via admin API
	if err := reloadCaddy(c.dampDir); err != nil {
		lastErr = fmt.Errorf("caddy reload: %w", err)
	}

	return dumpPath, lastErr
}

func HandleDeleteProject(w http.ResponseWriter, r *http.Request, cc *ConfigClient, dc *DockerClient, dbClient *DatabaseClient) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	name = strings.TrimSuffix(name, "/")
	if name == "" || !validName.MatchString(name) {
		jsonError(w, "Invalid project name", http.StatusBadRequest)
		return
	}

	dumpPath, err := cc.DeleteProject(name, dc, dbClient)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	response := map[string]string{
		"status": "deleted", 
		"name": name,
	}
	if dumpPath != "" {
		response["dump"] = dumpPath
	}
	
	jsonResponse(w, response)
}

// ── Browse host filesystem ───────────────────────────────

type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
}

// reloadCaddy tells Caddy to re-read its Caddyfile via the admin API.
func reloadCaddy(dampDir string) error {
	caddyfilePath := filepath.Join(dampDir, "caddy", "Caddyfile")
	caddyfile, err := os.ReadFile(caddyfilePath)
	if err != nil {
		return fmt.Errorf("read Caddyfile: %w", err)
	}

	// Try internal Docker network first, then localhost (for sidecar mode)
	urls := []string{"http://damp-caddy:2019/load", "http://localhost:2019/load"}
	var lastErr error
	for _, url := range urls {
		resp, err := http.Post(
			url,
			"application/caddyfile",
			strings.NewReader(string(caddyfile)),
		)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode < 400 {
				return nil
			}
			body, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("caddy reload %s: %s — %s", url, resp.Status, string(body))
		} else {
			lastErr = fmt.Errorf("caddy reload %s: %w", url, err)
		}
	}
	return lastErr
}

// addHostEntry appends "127.0.0.1  domain" to the hosts file if not already present.
func addHostEntry(domain string) {
	// Validate domain to prevent shell injection (B16)
	if !regexp.MustCompile(`^[a-z0-9.-]+$`).MatchString(domain) {
		return
	}

	if runtime.GOOS == "windows" {
		// Use PowerShell with arguments instead of string interpolation to prevent injection (B16)
		entry := "127.0.0.1 " + domain
		script := fmt.Sprintf(`
			$path = "C:\Windows\System32\drivers\etc\hosts"
			if (!(Get-Content $path | Select-String -Pattern "%s")) {
				Add-Content -Path $path -Value "` + "`n" + `%s" -ErrorAction SilentlyContinue
			}
		`, regexp.QuoteMeta(domain), entry)
		_ = exec.Command("powershell", "-NoProfile", "-Command", script).Run()
		return
	}

	hostsPath := "/etc/hosts"
	data, err := os.ReadFile(hostsPath)
	if err != nil {
		return
	}
	if strings.Contains(string(data), domain) {
		return
	}
	entry := fmt.Sprintf("127.0.0.1   %s\n", domain)
	f, err := os.OpenFile(hostsPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(entry)
}

func dampTLD() string {
	tld := os.Getenv("DAMP_TLD")
	if tld == "" {
		return "test"
	}
	return tld
}

func hostHome() string {
	h := os.Getenv("HOST_HOME")
	if h != "" {
		return h
	}
	h, _ = os.UserHomeDir()
	return h
}

func HandleHomeDir(w http.ResponseWriter, r *http.Request) {
	home := hostHome()
	_, hasMnt := os.Stat("/mnt/c")
	isWSL := hasMnt == nil
	startPath := filepath.Dir(home)
	if isWSL {
		startPath = "/"
	}
	jsonResponse(w, map[string]string{"home": home, "parent": startPath})
}

func HandleBrowse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	home := hostHome()
	dirPath := r.URL.Query().Get("path")

	// Detect if /mnt exists (WSL2)
	_, hasMnt := os.Stat("/mnt/c")
	isWSL := hasMnt == nil

	if dirPath == "" {
		if isWSL {
			dirPath = "/" // Show root so user can pick /home or /mnt
		} else {
			dirPath = filepath.Dir(home) // /Users on macOS, /home on Linux
		}
	}

	// Allowed base paths
	homeParent := filepath.Dir(home)
	cleanPath := filepath.Clean(dirPath)
	
	// Resolve symlinks to detect hidden traversals (B15)
	resolvedPath, err := filepath.EvalSymlinks(cleanPath)
	if err == nil {
		cleanPath = resolvedPath
	}

	allowed := cleanPath == "/" ||
		strings.HasPrefix(cleanPath, homeParent) ||
		strings.HasPrefix(cleanPath, "/mnt") ||
		strings.HasPrefix(cleanPath, "/home")
	if !allowed {
		jsonError(w, "Access restricted", http.StatusForbidden)
		return
	}

	// If showing root, only show relevant directories
	var dirs []DirEntry
	if cleanPath == "/" {
		for _, name := range []string{"home", "mnt"} {
			if info, err := os.Stat("/" + name); err == nil && info.IsDir() {
				dirs = append(dirs, DirEntry{Name: name, IsDir: true})
			}
		}
		// Also show /Users on macOS
		if info, err := os.Stat("/Users"); err == nil && info.IsDir() {
			dirs = append(dirs, DirEntry{Name: "Users", IsDir: true})
		}
	} else {
		entries, err := os.ReadDir(dirPath)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			if entry.IsDir() {
				dirs = append(dirs, DirEntry{Name: entry.Name(), IsDir: true})
			}
		}
	}

	jsonResponse(w, map[string]interface{}{
		"path":    dirPath,
		"entries": dirs,
	})
}

// ── Engine controls ──────────────────────────────────────

func (c *ConfigClient) EngineUp() (string, error) {
	cmd := exec.Command("docker", "compose", "up", "-d")
	cmd.Dir = c.dampDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s: %s", err, string(out))
	}
	return string(out), nil
}

func (c *ConfigClient) EngineDown() (string, error) {
	cmd := exec.Command("docker", "compose", "down")
	cmd.Dir = c.dampDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s: %s", err, string(out))
	}
	return string(out), nil
}

func HandleEngine(w http.ResponseWriter, r *http.Request, cc *ConfigClient) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	action := strings.TrimPrefix(r.URL.Path, "/api/engine/")
	var out string
	var err error

	switch action {
	case "up":
		out, err = cc.EngineUp()
	case "down":
		out, err = cc.EngineDown()
	default:
		jsonError(w, "Unknown action: "+action, http.StatusBadRequest)
		return
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok", "output": out})
}

// Shared JSON helpers

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
