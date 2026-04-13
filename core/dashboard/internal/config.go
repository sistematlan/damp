package internal

import (
	"context"
	"encoding/json"
	"fmt"
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

// ── Project creation ──────────────────────────────────────

type CreateProjectRequest struct {
	Name     string `json:"name"`
	Template string `json:"template"`
}

type CreateProjectResponse struct {
	Status   string `json:"status"`
	Name     string `json:"name"`
	Domain   string `json:"domain"`
	Database string `json:"database"`
	Output   string `json:"output"`
}

func (c *ConfigClient) CreateProject(name, template string, dbClient *DatabaseClient) (*CreateProjectResponse, error) {
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

	// 3. Generate Caddy config in projects.d/
	caddyDir := filepath.Join(c.dampDir, "caddy", "projects.d")
	os.MkdirAll(caddyDir, 0755)
	domain := name + ".local"
	caddyConfig := fmt.Sprintf("%s {\n    reverse_proxy %s-app:80\n}\n", domain, name)
	caddyPath := filepath.Join(caddyDir, name+".caddy")
	if err := os.WriteFile(caddyPath, []byte(caddyConfig), 0644); err != nil {
		return nil, fmt.Errorf("failed to write Caddy config: %w", err)
	}

	// 4. Reload Caddy via Docker API
	exec.Command("docker", "compose", "up", "-d", "caddy", "--force-recreate").Run()

	return &CreateProjectResponse{
		Status:   "created",
		Name:     name,
		Domain:   domain,
		Database: dbName,
		Output:   fmt.Sprintf("Project '%s' configured. Database: %s, Domain: %s", name, dbName, domain),
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
	if !validName.MatchString(req.Name) {
		jsonError(w, "invalid name: use lowercase letters, numbers, and hyphens only", http.StatusBadRequest)
		return
	}

	result, err := cc.CreateProject(req.Name, req.Template, dbClient)
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

	// Get running containers for status check
	runningContainers := make(map[string]bool)
	if dc != nil {
		ctx := context.Background()
		containers, _ := dc.ListContainers(ctx)
		for _, c := range containers {
			runningContainers[c.Name] = c.State == "running"
		}
	}

	var projects []ProjectStatus
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".caddy") {
			continue
		}
		projectName := strings.TrimSuffix(name, ".caddy")

		// Check if any container with this prefix is running
		status := "stopped"
		for containerName, isRunning := range runningContainers {
			if strings.HasPrefix(containerName, projectName+"-") && isRunning {
				status = "running"
				break
			}
		}

		projects = append(projects, ProjectStatus{
			Name:   projectName,
			Domain: projectName + ".local",
			Status: status,
		})
	}
	return projects, nil
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
