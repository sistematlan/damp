package internal

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const NetworkName = "damp"

type DockerClient struct {
	httpClient *http.Client
}

type ContainerInfo struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	State   string `json:"state"`
	Image   string `json:"image"`
	IsDamp  bool   `json:"is_damp"`
}

func NewDockerClient() (*DockerClient, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", "/var/run/docker.sock")
		},
	}
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}

	// Test connection
	resp, err := client.Get("http://localhost/version")
	if err != nil {
		return nil, fmt.Errorf("cannot connect to Docker socket: %w", err)
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

func (d *DockerClient) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	// Get network to find containers on damp network
	netData, err := d.dockerGet("/networks/" + NetworkName)
	if err != nil {
		return nil, err
	}

	var networkInfo struct {
		Containers map[string]struct {
			Name string `json:"Name"`
		} `json:"Containers"`
	}
	if err := json.Unmarshal(netData, &networkInfo); err != nil {
		return nil, err
	}

	containerNames := make(map[string]bool)
	for _, ep := range networkInfo.Containers {
		containerNames[ep.Name] = true
	}

	// Get all containers
	data, err := d.dockerGet("/containers/json?all=true")
	if err != nil {
		return nil, err
	}

	var rawContainers []struct {
		Names   []string `json:"Names"`
		State   string   `json:"State"`
		Status  string   `json:"Status"`
		Image   string   `json:"Image"`
	}
	if err := json.Unmarshal(data, &rawContainers); err != nil {
		return nil, err
	}

	var result []ContainerInfo
	for _, c := range rawContainers {
		name := strings.TrimPrefix(c.Names[0], "/")
		if !containerNames[name] {
			continue
		}
		result = append(result, ContainerInfo{
			Name:   name,
			Status: c.Status,
			State:  c.State,
			Image:  c.Image,
			IsDamp: strings.HasPrefix(name, "damp-"),
		})
	}
	return result, nil
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

func HandleProjectAction(w http.ResponseWriter, r *http.Request, dc *DockerClient) {
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

	if action != "start" && action != "stop" && action != "restart" {
		jsonError(w, "Unknown action: "+action, http.StatusBadRequest)
		return
	}

	affected, err := dc.ProjectAction(r.Context(), name, action)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{"status": "ok", "action": action, "containers": affected})
}

func (d *DockerClient) StreamLogs(name string) (io.ReadCloser, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", "/var/run/docker.sock")
		},
	}
	client := &http.Client{Transport: transport} // no timeout for streaming
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
	containers, err := dc.ListContainers(r.Context())
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
	w.Header().Set("Access-Control-Allow-Origin", "*")

	reader, err := dc.StreamLogs(name)
	if err != nil {
		fmt.Fprintf(w, "data: [Error: %s]\n\n", err.Error())
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
			fmt.Fprintf(w, "data: %s\n\n", strings.ReplaceAll(string(line), "\n", ""))
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
	w.Header().Set("Access-Control-Allow-Origin", "*")

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
	containers, err := dc.ListContainers(ctx)
	if err != nil {
		return
	}
	data, _ := json.Marshal(containers)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

func HandleStatus(w http.ResponseWriter, r *http.Request, dc *DockerClient, db *DatabaseClient) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	containers, _ := dc.ListContainers(ctx)
	databases, _ := db.ListDatabases()

	status := map[string]interface{}{
		"docker_running": true,
		"containers":     containers,
		"databases":      databases,
	}
	jsonResponse(w, status)
}
