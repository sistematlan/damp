package internal

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

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

func (c *ConfigClient) ListTemplates() ([]TemplateInfo, error) {
	dir := filepath.Join(c.dampDir, "templates")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	descriptions := map[string]string{
		"frankenphp":  "PHP 8.4 + FrankenPHP (modern, fast)",
		"php-fpm":     "PHP 8.4 + Nginx + FPM (classic)",
		"php-legacy":  "PHP 7.4 + Nginx + FPM (legacy)",
		"php-ancient": "PHP 5.6 + Apache (rescue)",
		"node":        "Node.js 22 (React, Vue, Astro, etc.)",
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

// Shared JSON helpers

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
