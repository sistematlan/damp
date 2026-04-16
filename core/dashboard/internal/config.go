package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var validName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

type ConfigClient struct {
	dampDir string
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

func HandleProjects(w http.ResponseWriter, r *http.Request, cc *ConfigClient) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	projects, err := cc.ListProjects()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, projects)
}

func (c *ConfigClient) ListTemplates() ([]TemplateInfo, error) {
	dir := filepath.Join(c.dampDir, "templates")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	descriptions := map[string]string{
		"frankenphp":  "PHP 8.4 + FrankenPHP (Laravel, CI4, Symfony)",
		"php-fpm":     "PHP 8.4 + Nginx + FPM (classic)",
		"php-legacy":  "PHP 7.4 + Nginx + FPM (CI3, Laravel 8)",
		"php-ancient": "PHP 5.6 + Apache (legacy rescue)",
		"node":        "Node.js 22 (React, Vue, Astro, Express)",
		"wordpress":   "WordPress (official image)",
	}

	var templates []TemplateInfo
	for _, entry := range entries {
		if entry.IsDir() {
			desc := descriptions[entry.Name()]
			if desc == "" {
				desc = entry.Name()
			}
			templates = append(templates, TemplateInfo{
				Name:        entry.Name(),
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
	Name string `json:"name"`
	Path string `json:"path"`
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
		return nil, err
	}
	var entries []ProjectEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return []ProjectEntry{}, nil
	}
	return entries, nil
}

func (c *ConfigClient) saveRegistry(entries []ProjectEntry) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.registryPath(), data, 0644)
}

func (c *ConfigClient) RegisterProject(name, path string) {
	entries, _ := c.loadRegistry()
	// Update if exists, append if new
	found := false
	for i, e := range entries {
		if e.Name == name {
			entries[i].Path = path
			found = true
			break
		}
	}
	if !found {
		entries = append(entries, ProjectEntry{Name: name, Path: path})
	}
	c.saveRegistry(entries)
}

func (c *ConfigClient) UnregisterProject(name string) {
	entries, _ := c.loadRegistry()
	var filtered []ProjectEntry
	for _, e := range entries {
		if e.Name != name {
			filtered = append(filtered, e)
		}
	}
	c.saveRegistry(filtered)
}

func (c *ConfigClient) GetProjectPath(name string) string {
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
	caddyConfig := fmt.Sprintf("%s {\n    reverse_proxy %s-app:80\n}\n", domain, name)
	caddyPath := filepath.Join(caddyDir, name+".caddy")
	if err := os.WriteFile(caddyPath, []byte(caddyConfig), 0644); err != nil {
		return nil, fmt.Errorf("failed to write Caddy config: %w", err)
	}

	// 4. Reload Caddy via admin API (stays inside Docker network)
	if err := reloadCaddy(); err != nil {
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
		// Ensure absolute path
		if !filepath.IsAbs(projectPath) {
			return nil, fmt.Errorf("path must be absolute (e.g. %s/projects/%s)", hostHome(), name)
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

		// Start containers — use --project-directory so Docker daemon
		// resolves volume mounts relative to the host path
		composeCmd := exec.Command("docker", "compose",
			"--project-directory", projectPath,
			"up", "-d", "--build")
		composeCmd.Dir = projectPath
		composeOut, err := composeCmd.CombinedOutput()
		if err != nil {
			status = "error"
			output = fmt.Sprintf("Config created but failed to start: %s", string(composeOut))
		} else {
			status = "running"
			output = fmt.Sprintf("Project '%s' is running at https://%s", name, domain)
		}
	}

	c.RegisterProject(name, projectPath)

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

	// Get ALL containers (including stopped) for status check
	// key: container name, value: state (running, exited, etc.)
	allContainers := make(map[string]string)
	if dc != nil {
		data, _ := dc.GetAllContainers()
		for _, c := range data {
			allContainers[c.Name] = c.State
		}
	}

	var projects []ProjectStatus
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".caddy") || name == "registry.json" {
			continue
		}
		projectName := strings.TrimSuffix(name, ".caddy")

		// Check containers with this prefix
		status := "created" // config exists but no containers
		for containerName, state := range allContainers {
			if strings.HasPrefix(containerName, projectName+"-") {
				if state == "running" {
					status = "running"
					break
				}
				status = "stopped" // container exists but not running
			}
		}

		projects = append(projects, ProjectStatus{
			Name:   projectName,
			Domain: projectName + "." + dampTLD(),
			Status: status,
		})
	}
	return projects, nil
}

// ── Delete project ───────────────────────────────────────

func (c *ConfigClient) DeleteProject(name string, dc *DockerClient, dbClient *DatabaseClient) error {
	// 1. Stop containers
	if dc != nil {
		ctx := context.Background()
		dc.ProjectAction(ctx, name, "stop")
	}

	// 2. Remove Caddy config
	caddyPath := filepath.Join(c.dampDir, "caddy", "projects.d", name+".caddy")
	os.Remove(caddyPath)

	// 3. Drop database (best effort)
	dbName := strings.ReplaceAll(name, "-", "_") + "_db"
	if dbClient != nil {
		dbClient.DropDatabase(dbName)
	}

	// 4. Unregister
	c.UnregisterProject(name)

	// 5. Reload Caddy via admin API
	reloadCaddy() // best-effort: project config file is already deleted

	return nil
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

	if err := cc.DeleteProject(name, dc, dbClient); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "deleted", "name": name})
}

// ── Browse host filesystem ───────────────────────────────

type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
}

// reloadCaddy tells Caddy to re-read its Caddyfile via the admin API.
// This picks up any new project configs added to projects.d/ without
// recreating the container.  Works across all Docker runtimes (macOS,
// Linux, WSL2) because the call stays inside the Docker network.
func reloadCaddy() error {
	caddyfile, err := os.ReadFile("/damp/caddy/Caddyfile")
	if err != nil {
		return fmt.Errorf("read Caddyfile: %w", err)
	}
	resp, err := http.Post(
		"http://damp-caddy:2019/load",
		"application/caddyfile",
		strings.NewReader(string(caddyfile)),
	)
	if err != nil {
		return fmt.Errorf("caddy reload: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy reload: %s — %s", resp.Status, string(body))
	}
	return nil
}

// addHostEntry appends "127.0.0.1  domain" to /etc/hosts if not already present.
//
// This is a best-effort fallback. The primary DNS mechanism is a host-native
// dnsmasq instance configured by setup-dns.sh, which resolves all *.TLD domains
// to 127.0.0.1 without requiring per-project /etc/hosts entries.
//
// On macOS with Docker/OrbStack the /etc/hosts bind-mount is read-only from
// the host's perspective, so writes here only affect the container. On Linux
// with a writable bind-mount it works as expected. Either way, if dnsmasq is
// running on the host this function is a no-op (domain already resolves).
func addHostEntry(domain string) {
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
