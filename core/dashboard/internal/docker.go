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
	"sync"
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
	httpClient     *http.Client
	resourceMu     sync.RWMutex
	resourceCache  map[string]*ContainerResources
	runtimeSummary RuntimeSummary
	refreshing     bool
}

type ContainerInfo struct {
	Name      string              `json:"name"`
	Status    string              `json:"status"`
	State     string              `json:"state"`
	Image     string              `json:"image"`
	IsDamp    bool                `json:"is_damp"`
	HostPath  string              `json:"host_path,omitempty"` // New field
	Resources *ContainerResources `json:"resources,omitempty"`
}

type ContainerResources struct {
	MemoryUsage   uint64  `json:"memory_usage"`
	MemoryLimit   uint64  `json:"memory_limit"`
	MemoryPercent float64 `json:"memory_percent"`
	CPUPercent    float64 `json:"cpu_percent"`
	PIDs          uint64  `json:"pids"`
	MemoryLimited bool    `json:"memory_limited"`
	SwapLimited   bool    `json:"swap_limited"`
	Pressure      string  `json:"pressure"`
}

type RuntimeSummary struct {
	MemoryUsage       uint64    `json:"memory_usage"`
	MemoryLimit       uint64    `json:"memory_limit"`
	RunningContainers int       `json:"running_containers"`
	LimitedContainers int       `json:"limited_containers"`
	Warnings          int       `json:"warnings"`
	SampledAt         time.Time `json:"sampled_at"`
}

func effectiveMemoryUsage(usage, inactiveFile, cache uint64) uint64 {
	reclaimable := inactiveFile
	if reclaimable == 0 {
		reclaimable = cache
	}
	if reclaimable < usage {
		return usage - reclaimable
	}
	return usage
}

func memoryPressure(memoryPercent float64, limited bool) string {
	if !limited {
		return "unbounded"
	}
	if memoryPercent >= 90 {
		return "critical"
	}
	if memoryPercent >= 75 {
		return "warning"
	}
	return "ok"
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

	return &DockerClient{httpClient: client, resourceCache: make(map[string]*ContainerResources)}, nil
}

func (d *DockerClient) dockerGet(path string) ([]byte, error) {
	return d.dockerGetContext(context.Background(), path)
}

func (d *DockerClient) dockerGetContext(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://localhost"+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker API error %d: %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}

func (d *DockerClient) containerResources(ctx context.Context, name string) (*ContainerResources, error) {
	statsData, err := d.dockerGetContext(ctx, "/containers/"+name+"/stats?stream=false")
	if err != nil {
		return nil, err
	}
	var stats struct {
		MemoryStats struct {
			Usage uint64 `json:"usage"`
			Limit uint64 `json:"limit"`
			Stats struct {
				InactiveFile uint64 `json:"inactive_file"`
				Cache        uint64 `json:"cache"`
			} `json:"stats"`
		} `json:"memory_stats"`
		CPUStats struct {
			CPUUsage struct {
				TotalUsage  uint64   `json:"total_usage"`
				PercpuUsage []uint64 `json:"percpu_usage"`
			} `json:"cpu_usage"`
			SystemCPUUsage uint64 `json:"system_cpu_usage"`
			OnlineCPUs     uint64 `json:"online_cpus"`
		} `json:"cpu_stats"`
		PreCPUStats struct {
			CPUUsage struct {
				TotalUsage uint64 `json:"total_usage"`
			} `json:"cpu_usage"`
			SystemCPUUsage uint64 `json:"system_cpu_usage"`
		} `json:"precpu_stats"`
		PidsStats struct {
			Current uint64 `json:"current"`
		} `json:"pids_stats"`
	}
	if err := json.Unmarshal(statsData, &stats); err != nil {
		return nil, fmt.Errorf("decode stats for %s: %w", name, err)
	}

	inspectData, err := d.dockerGetContext(ctx, "/containers/"+name+"/json")
	if err != nil {
		return nil, err
	}
	var inspect struct {
		HostConfig struct {
			Memory     int64 `json:"Memory"`
			MemorySwap int64 `json:"MemorySwap"`
		} `json:"HostConfig"`
	}
	if err := json.Unmarshal(inspectData, &inspect); err != nil {
		return nil, fmt.Errorf("decode limits for %s: %w", name, err)
	}

	usage := effectiveMemoryUsage(stats.MemoryStats.Usage, stats.MemoryStats.Stats.InactiveFile, stats.MemoryStats.Stats.Cache)
	limit := uint64(0)
	if inspect.HostConfig.Memory > 0 {
		limit = uint64(inspect.HostConfig.Memory)
	}
	memoryPercent := float64(0)
	if limit > 0 {
		memoryPercent = float64(usage) / float64(limit) * 100
	}
	cpuPercent := float64(0)
	cpuDelta := stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage
	systemDelta := stats.CPUStats.SystemCPUUsage - stats.PreCPUStats.SystemCPUUsage
	cores := stats.CPUStats.OnlineCPUs
	if cores == 0 {
		cores = uint64(len(stats.CPUStats.CPUUsage.PercpuUsage))
	}
	if systemDelta > 0 && cpuDelta > 0 && cores > 0 {
		cpuPercent = float64(cpuDelta) / float64(systemDelta) * float64(cores) * 100
	}
	pressure := memoryPressure(memoryPercent, limit > 0)
	return &ContainerResources{
		MemoryUsage: usage, MemoryLimit: limit, MemoryPercent: memoryPercent,
		CPUPercent: cpuPercent, PIDs: stats.PidsStats.Current,
		MemoryLimited: limit > 0,
		SwapLimited:   inspect.HostConfig.Memory > 0 && inspect.HostConfig.MemorySwap == inspect.HostConfig.Memory,
		Pressure:      pressure,
	}, nil
}

func (d *DockerClient) attachResources(ctx context.Context, containers []ContainerInfo) RuntimeSummary {
	summary := RuntimeSummary{SampledAt: time.Now().UTC()}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for i := range containers {
		if containers[i].State != "running" {
			continue
		}
		summary.RunningContainers++
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			resources, err := d.containerResources(ctx, containers[index].Name)
			if err != nil {
				return
			}
			containers[index].Resources = resources
			mu.Lock()
			defer mu.Unlock()
			summary.MemoryUsage += resources.MemoryUsage
			if resources.MemoryLimited {
				summary.MemoryLimit += resources.MemoryLimit
				summary.LimitedContainers++
			}
			if resources.Pressure == "warning" || resources.Pressure == "critical" {
				summary.Warnings++
			}
		}(i)
	}
	wg.Wait()
	return summary
}

// resourcesSnapshot keeps Docker's relatively slow stats sampling off the
// request path. Callers receive the latest immutable sample while a stale
// cache is refreshed in the background.
func (d *DockerClient) resourcesSnapshot(containers []ContainerInfo) RuntimeSummary {
	d.resourceMu.RLock()
	for i := range containers {
		if resource := d.resourceCache[containers[i].Name]; resource != nil {
			containers[i].Resources = resource
		}
	}
	summary := d.runtimeSummary
	stale := summary.SampledAt.IsZero() || time.Since(summary.SampledAt) >= 5*time.Second
	refreshing := d.refreshing
	d.resourceMu.RUnlock()

	if stale && !refreshing {
		d.resourceMu.Lock()
		if !d.refreshing {
			d.refreshing = true
			copyForSample := append([]ContainerInfo(nil), containers...)
			go d.refreshResourceCache(copyForSample)
		}
		d.resourceMu.Unlock()
	}
	return summary
}

func (d *DockerClient) refreshResourceCache(containers []ContainerInfo) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	summary := d.attachResources(ctx, containers)
	cache := make(map[string]*ContainerResources)
	for i := range containers {
		if containers[i].Resources != nil {
			cache[containers[i].Name] = containers[i].Resources
		}
	}
	d.resourceMu.Lock()
	d.resourceCache = cache
	d.runtimeSummary = summary
	d.refreshing = false
	d.resourceMu.Unlock()
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
				"error":   "path_required",
				"message": "Project path unknown. Please link a folder.",
			})
			return
		}

		// Ensure database exists before starting (B13 enhancement)
		// We use a temporary dbClient for this check
		dbHost := os.Getenv("DB_HOST")
		if dbHost == "" {
			dbHost = "damp-db"
		}
		dbPass := os.Getenv("DB_ROOT_PASSWORD")
		dbClient := NewDatabaseClient(dbHost, dbPass)

		dbName := strings.ReplaceAll(name, "-", "_") + "_db"
		dbs, _ := dbClient.ListDatabases()
		exists := false
		for _, d := range dbs {
			if d == dbName {
				exists = true
				break
			}
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

	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	type dockerResult struct {
		running    bool
		containers []ContainerInfo
		summary    RuntimeSummary
		err        string
	}
	type dbResult struct {
		names []string
		err   string
	}
	dockerCh := make(chan dockerResult, 1)
	mysqlCh := make(chan dbResult, 1)
	postgresCh := make(chan dbResult, 1)
	redisCh := make(chan RedisInfo, 1)

	go func() {
		result := dockerResult{containers: []ContainerInfo{}}
		if err := dc.Ping(ctx); err != nil {
			result.err = err.Error()
			dockerCh <- result
			return
		}
		result.running = true
		containers, err := dc.ListContainers(ctx, false)
		if err != nil {
			result.err = err.Error()
			dockerCh <- result
			return
		}
		result.containers = containers
		result.summary = dc.resourcesSnapshot(result.containers)
		dockerCh <- result
	}()
	go func() {
		queryCtx, queryCancel := context.WithTimeout(ctx, 750*time.Millisecond)
		defer queryCancel()
		names, err := db.ListDatabasesContext(queryCtx)
		if err != nil {
			mysqlCh <- dbResult{names: []string{}, err: err.Error()}
			return
		}
		mysqlCh <- dbResult{names: names}
	}()
	go func() {
		queryCtx, queryCancel := context.WithTimeout(ctx, 750*time.Millisecond)
		defer queryCancel()
		names, err := pg.ListDatabasesContext(queryCtx)
		if err != nil {
			postgresCh <- dbResult{names: []string{}, err: err.Error()}
			return
		}
		postgresCh <- dbResult{names: names}
	}()
	go func() { redisCh <- GetRedisInfo(redisHost) }()

	docker := <-dockerCh
	mysql := <-mysqlCh
	postgres := <-postgresCh
	redis := <-redisCh

	status := map[string]interface{}{
		"docker_running":     docker.running,
		"containers":         docker.containers,
		"containers_error":   docker.err,
		"runtime":            docker.summary,
		"databases":          mysql.names,
		"databases_error":    mysql.err,
		"postgres_databases": postgres.names,
		"postgres_error":     postgres.err,
		"redis":              redis,
		"response_time_ms":   time.Since(started).Milliseconds(),
	}
	jsonResponse(w, status)
}
