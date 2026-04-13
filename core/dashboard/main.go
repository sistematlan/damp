package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/sistematlan/damp/dashboard/internal"
)

//go:embed web/*
var webFS embed.FS

func main() {
	port := os.Getenv("DASHBOARD_PORT")
	if port == "" {
		port = "9000"
	}

	dockerClient, err := internal.NewDockerClient()
	if err != nil {
		log.Fatalf("Failed to connect to Docker: %v", err)
	}

	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "damp-db"
	}
	dbPass := os.Getenv("DB_ROOT_PASSWORD")
	if dbPass == "" {
		dbPass = "root"
	}
	dbClient := internal.NewDatabaseClient(dbHost, dbPass)

	pgHost := os.Getenv("PG_HOST")
	if pgHost == "" {
		pgHost = "damp-postgres"
	}
	pgClient := internal.NewPostgresClient(pgHost, dbPass)

	redisHost := os.Getenv("REDIS_HOST")
	if redisHost == "" {
		redisHost = "damp-redis"
	}

	dampDir := os.Getenv("DAMP_DIR")
	if dampDir == "" {
		dampDir = "/damp"
	}
	configClient := internal.NewConfigClient(dampDir)

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleStatus(w, r, dockerClient, dbClient)
	})
	mux.HandleFunc("/api/containers", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleContainers(w, r, dockerClient)
	})
	mux.HandleFunc("/api/containers/", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleContainerAction(w, r, dockerClient)
	})
	mux.HandleFunc("/api/databases", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleDatabases(w, r, dbClient, pgClient)
	})
	mux.HandleFunc("/api/databases/", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleDatabaseAction(w, r, dbClient, pgClient)
	})
	mux.HandleFunc("/api/redis", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleRedis(w, r, redisHost)
	})
	mux.HandleFunc("/api/templates", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleTemplates(w, r, configClient)
	})
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			internal.HandleCreateProject(w, r, configClient, dbClient)
			return
		}
		projects, err := configClient.ListProjectsFromCaddy(dockerClient)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"` + err.Error() + `"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(projects)
	})
	mux.HandleFunc("/api/engine/", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleEngine(w, r, configClient)
	})
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleSSEEvents(w, r, dockerClient)
	})

	// Serve embedded frontend
	webContent, _ := fs.Sub(webFS, "web")
	fileServer := http.FileServer(http.FS(webContent))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path != "/" && !strings.Contains(path, ".") && !strings.HasPrefix(path, "/api/") {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("DAMP Dashboard running on http://0.0.0.0:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
