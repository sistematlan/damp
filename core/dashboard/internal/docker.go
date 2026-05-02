package internal

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const NetworkName = "damp"

func dialDocker() (net.Conn, error) {
	if runtime.GOOS == "windows" {
		return net.Dial("unix", "//./pipe/docker_engine")
	}
	return net.Dial("unix", "/var/run/docker.sock")
}

type DockerClient struct {
	httpClient *http.Client
}

type ContainerInfo struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	State    string `json:"state"`
	Image    string `json:"image"`
	IsDamp   bool   `json:"is_damp"`
	HostPath string `json:"host_path,omitempty"` // New field
}

func NewDockerClient() (*DockerClient, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialDocker()
		},
	}
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}

	// Test connection
	resp, err := client.Get("http://localhost/version")
	if err != nil {
		return nil, fmt.Errorf("cannot connect to Docker: %w", err)
	}
	resp.Body.Close()

	return &DockerClient{httpClient: client}, nil
}

func (d *DockerClient) dockerGet(path string) ([]byte, error) {
	resp, err := d.httpClient.Get("http://localhost" + path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func (d *DockerClient) dockerPost(path string) error {
	resp, err := d.httpClient.Post("http://localhost"+path, "", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker API error %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// ListContainers returns containers, optionally filtered by the 'damp' network
func (d *DockerClient) ListContainers(ctx context.Context, onlyDamp bool) ([]ContainerInfo, error) {
	// 1. Get all containers from Docker API
	data, err := d.dockerGet("/containers/json?all=true")
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	var rawContainers []struct {
		Names  []string `json:"Names"`
		State  string   `json:"State"`
		Status string   `json:"Status"`
		Image  string   `json:"Image"`
		Mounts []struct {
			Source string `json:"Source"`
			Type   string `json:"Type"`
		} `json:"Mounts"`
	}
	if err := json.Unmarshal(data, &rawContainers); err != nil {
		return nil, fmt.Errorf("decode containers: %w", err)
	}

	// 2. If filtering by network, get damp network info
	dampContainerNames := make(map[string]bool)
	if onlyDamp {
		netData, err := d.dockerGet("/networks/" + NetworkName)
		if err == nil {
			var networkInfo struct {
				Containers map[string]struct {
					Name string `json:"Name"`
				} `json:"Containers"`
			}
			if err := json.Unmarshal(netData, &networkInfo); err == nil {
				for _, ep := range networkInfo.Containers {
					dampContainerNames[ep.Name] = true
				}
			}
		}
	}

	var result []ContainerInfo
	for _, c := range rawContainers {
		if len(c.Names) == 0 {
			continue
		}
		name := strings.TrimPrefix(c.Names[0], "/")
		
		// Apply network filter if requested
		if onlyDamp && !dampContainerNames[name] {
			continue
		}

		// Try to find the host path from mounts (Smart Detection)
		hostPath := ""
		for _, m := range c.Mounts {
			if m.Type == "bind" && !strings.Contains(m.Source, "/.damp/") && !strings.Contains(m.Source, "/caddy") {
				hostPath = m.Source
				break
			}
		}

		result = append(result, ContainerInfo{
			Name:     name,
			Status:   c.Status,
			State:    c.State,
			Image:    c.Image,
			IsDamp:   strings.HasPrefix(name, "damp-"),
			HostPath: hostPath,
		})
	}
	return result, nil
}

// GetAllContainers is now a simple wrapper (B20)
func (d *DockerClient) GetAllContainers() ([]ContainerInfo, error) {
	return d.ListContainers(context.Background(), false)
}

func (d *DockerClient) StartContainer(ctx context.Context, name string) error {
	return d.dockerPost("/containers/" + name + "/start")
}

func (d *DockerClient) StopContainer(ctx context.Context, name string) error {
	return d.dockerPost("/containers/" + name + "/stop")
}

func (d *DockerClient) RestartContainer(ctx context.Context, name string) error {
	return d.dockerPost("/containers/" + name + "/restart")
}

// Start/stop all containers matching a project prefix (e.g. "myproject-")
func (d *DockerClient) ProjectAction(ctx context.Context, projectName string, action string) (int, error) {
	// List ALL containers (including stopped) - not just damp network
	data, err := d.dockerGet("/containers/json?all=true")
	if err != nil {
		return 0, err
	}

	var rawContainers []struct {
		Names []string `json:"Names"`
		State string   `json:"State"`
	}
	if err := json.Unmarshal(data, &rawContainers); err != nil {
		return 0, err
	}

	prefix := projectName + "-"
	affected := 0
	for _, rc := range rawContainers {
		name := strings.TrimPrefix(rc.Names[0], "/")
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		var actionErr error
		switch action {
		case "start":
			actionErr = d.StartContainer(ctx, name)
		case "stop":
			actionErr = d.StopContainer(ctx, name)
		case "restart":
			actionErr = d.RestartContainer(ctx, name)
		}
		if actionErr == nil {
			affected++
		}
	}
	return affected, nil
}

func HandleProjectAction(w http.ResponseWriter, r *http.Request, dc *DockerClient, cc *ConfigClient) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// /api/projects/{name}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 {
		jsonError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	name := parts[0]
	action := parts[1]

	if !validName.MatchString(name) {
		jsonError(w, "Invalid project name format", http.StatusBadRequest)
		return
	}

	if action != "start" && action != "stop" && action != "restart" {
		jsonError(w, "Unknown action: "+action, http.StatusBadRequest)
		return
	}

	// Record start request timestamp so ListProjectsFromCaddy can show "starting"
	if action == "start" || action == "restart" {
		cc.RecordStartRequest(name)
	}

	affected, err := dc.ProjectAction(r.Context(), name, action)
	
	// Smart Start Improvement: If start requested and no containers exist, ensure environment is ready
	if action == "start" && affected == 0 && err == nil {
		projectPath := cc.GetProjectPath(name)
		
		if projectPath == "" {
			// Tell the frontend we need a path to start this project (it's unlinked)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPreconditionRequired)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "path_required",
				"message": "Project path unknown. Please link a folder.",
			})
			return
		}

		// Ensure database exists before starting (B13 enhancement)
		// We use a temporary dbClient for this check
		dbHost := os.Getenv("DB_HOST")
		if dbHost == "" { dbHost = "damp-db" }
		dbPass := os.Getenv("DB_ROOT_PASSWORD")
		dbClient := NewDatabaseClient(dbHost, dbPass)
		
		dbName := strings.ReplaceAll(name, "-", "_") + "_db"
		dbs, _ := dbClient.ListDatabases()
		exists := false
		for _, d := range dbs {
			if d == dbName { exists = true; break }
		}
		if !exists {
			log.Printf("SmartStart: Creating missing database %s for project %s", dbName, name)
			dbClient.CreateDatabase(dbName)
		}

		// Now trigger the docker compose up
		go func() {
			cmd := exec.Command("docker", "compose", "--project-directory", projectPath, "up", "-d")
			cmd.Dir = projectPath
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("SmartStart: Auto-start project %s failed: %v\nOutput: %s", name, err, string(out))
			} else {
				log.Printf("SmartStart: Auto-start project %s successful", name)
			}
		}()
		
		jsonResponse(w, map[string]interface{}{"status": "starting", "action": action, "info": "environment ensured and project starting"})
		return
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{"status": "ok", "action": action, "containers": affected})
}

func (d *DockerClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost/_ping", nil)
	if err != nil {
		return err
	}
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ping failed: %d", resp.StatusCode)
	}
	return nil
}

func (d *DockerClient) StreamLogs(name string) (io.ReadCloser, error) {
	// Reusing the same transport as d.httpClient to avoid goroutine leaks
	// but with a dedicated client that has no timeout for streaming.
	client := &http.Client{
		Transport: d.httpClient.Transport,
		Timeout:   0,
	}
	resp, err := client.Get("http://localhost/containers/" + name + "/logs?stdout=true&stderr=true&follow=true&tail=100")
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

// HTTP Handlers

func HandleContainers(w http.ResponseWriter, r *http.Request, dc *DockerClient) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Default to only showing DAMP containers for the main containers list
	containers, err := dc.ListContainers(r.Context(), true)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, containers)
}

func HandleContainerAction(w http.ResponseWriter, r *http.Request, dc *DockerClient) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/containers/"), "/")
	if len(parts) < 2 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	name := parts[0]
	action := parts[1]

	if action == "logs" {
		handleContainerLogs(w, r, dc, name)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	var err error
	switch action {
	case "start":
		err = dc.StartContainer(ctx, name)
	case "stop":
		err = dc.StopContainer(ctx, name)
	case "restart":
		err = dc.RestartContainer(ctx, name)
	default:
		http.Error(w, "Unknown action: "+action, http.StatusBadRequest)
		return
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func handleContainerLogs(w http.ResponseWriter, r *http.Request, dc *DockerClient, name string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	reader, err := dc.StreamLogs(name)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer reader.Close()

	ctx := r.Context()
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
			line := scanner.Bytes()
			// Docker log lines have 8-byte header prefix
			if len(line) > 8 {
				line = line[8:]
			}
			fmt.Fprintf(w, "event: log-line\ndata: %s\n\n", strings.ReplaceAll(string(line), "\n", ""))
			flusher.Flush()
		}
	}
}

func HandleSSEEvents(w http.ResponseWriter, r *http.Request, dc *DockerClient) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ctx := r.Context()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	sendContainerStatus(w, flusher, dc, ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sendContainerStatus(w, flusher, dc, ctx)
		}
	}
}

func sendContainerStatus(w http.ResponseWriter, flusher http.Flusher, dc *DockerClient, ctx context.Context) {
	containers, err := dc.ListContainers(ctx, false)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	data, _ := json.Marshal(containers)
	fmt.Fprintf(w, "event: container-status\ndata: %s\n\n", data)
	flusher.Flush()
}

func HandleStatus(w http.ResponseWriter, r *http.Request, dc *DockerClient, db *DatabaseClient, pg *PostgresClient, redisHost string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var dockerRunning bool
	var containers []ContainerInfo
	var containersErr string
	if err := dc.Ping(ctx); err == nil {
		dockerRunning = true
		if c, err := dc.ListContainers(ctx, false); err == nil {
			containers = c
		} else {
			containersErr = err.Error()
		}
	}

	var databases []string
	var databasesErr string
	if d, err := db.ListDatabases(); err == nil {
		databases = d
	} else {
		databasesErr = err.Error()
	}

	var pgDatabases []string
	var pgDatabasesErr string
	if p, err := pg.ListDatabases(); err == nil {
		pgDatabases = p
	} else {
		pgDatabasesErr = err.Error()
	}

	redis := GetRedisInfo(redisHost)

	status := map[string]interface{}{
		"docker_running":      dockerRunning,
		"containers":          containers,
		"containers_error":    containersErr,
		"databases":           databases,
		"databases_error":     databasesErr,
		"postgres_databases":  pgDatabases,
		"postgres_error":      pgDatabasesErr,
		"redis":               redis,
	}
	jsonResponse(w, status)
}
