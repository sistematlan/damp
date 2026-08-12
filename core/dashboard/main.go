package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/sistematlan/damp/dashboard/internal"
)

//go:embed web/*
var webFS embed.FS

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC ERROR] %v\nStack: %s", err, debug.Stack())
				if r.Header.Get("Accept") == "text/event-stream" {
					fmt.Fprintf(w, "event: error\ndata: Internal server error\n\n")
					return
				}
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isLocalOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			if origin != "" && !isLocalOrigin(origin) {
				http.Error(w, "Origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if origin != "" && !isLocalOrigin(origin) {
			http.Error(w, "Origin not allowed", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLocalOrigin(origin string) bool {
	if origin == "" || origin == "tauri://localhost" || origin == "https://tauri.localhost" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %v", r.Method, r.URL.Path, sw.status, time.Since(start))
	})
}

func main() {
	port := os.Getenv("DASHBOARD_PORT")
	if port == "" {
		port = "9000"
	}

	dbPass := os.Getenv("DB_ROOT_PASSWORD")
	if dbPass == "" {
		log.Fatal("DB_ROOT_PASSWORD environment variable is required")
	}

	dockerClient, err := internal.NewDockerClient()
	if err != nil {
		log.Fatalf("Failed to connect to Docker: %v", err)
	}

	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "damp-db"
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
		internal.HandleStatus(w, r, dockerClient, dbClient, pgClient, redisHost)
	})
	mux.HandleFunc("/api/containers", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleContainers(w, r, dockerClient)
	})
	mux.HandleFunc("/api/containers/", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleContainerAction(w, r, dockerClient)
	})
	mux.HandleFunc("/api/services/", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleServiceAction(w, r, configClient, dockerClient)
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
	mux.HandleFunc("/api/home", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleHomeDir(w, r)
	})
	mux.HandleFunc("/api/browse", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleBrowse(w, r)
	})
	mux.HandleFunc("/api/templates", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleTemplates(w, r, configClient)
	})
	mux.HandleFunc("/api/detect-template", func(w http.ResponseWriter, r *http.Request) {
		internal.HandleDetectTemplate(w, r)
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
		json.NewEncoder(w).Encode(projects)
	})
	mux.HandleFunc("/api/projects/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			internal.HandleDeleteProject(w, r, configClient, dockerClient, dbClient)
			return
		}
		internal.HandleProjectAction(w, r, dockerClient, configClient)
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

	// Apply middleware
	handler := loggingMiddleware(corsMiddleware(recoveryMiddleware(mux)))

	bind := os.Getenv("DASHBOARD_BIND")
	if bind == "" {
		bind = "127.0.0.1"
	}
	server := &http.Server{
		Addr:         bind + ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown setup
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("DAMP Dashboard running on http://%s:%s", bind, port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Could not listen on %s: %v\n", port, err)
		}
	}()

	<-stop
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server gracefully stopped")
}
