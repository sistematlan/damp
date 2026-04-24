package internal

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"
)

var validDBName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

type DatabaseClient struct {
	dsn string
}

type PostgresClient struct {
	dsn string
}

func NewDatabaseClient(host, password string) *DatabaseClient {
	return &DatabaseClient{
		dsn: fmt.Sprintf("root:%s@tcp(%s:3306)/", password, host),
	}
}

func NewPostgresClient(host, password string) *PostgresClient {
	return &PostgresClient{
		dsn: fmt.Sprintf("host=%s port=5432 user=root password=%s dbname=postgres sslmode=disable", host, password),
	}
}

func (d *DatabaseClient) connect() (*sql.DB, error) {
	return sql.Open("mysql", d.dsn)
}

var systemDBs = map[string]bool{
	"information_schema": true,
	"mysql":              true,
	"performance_schema": true,
	"sys":                true,
}

var systemPGDBs = map[string]bool{
	"postgres":  true,
	"template0": true,
	"template1": true,
}

// ── MySQL ─────────────────────────────────────────────────

func (d *DatabaseClient) ListDatabases() ([]string, error) {
	db, err := d.connect()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query("SHOW DATABASES")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var databases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		if !systemDBs[name] {
			databases = append(databases, name)
		}
	}
	return databases, nil
}

func (d *DatabaseClient) CreateDatabase(name string) error {
	db, err := d.connect()
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
		name,
	))
	return err
}

func (d *DatabaseClient) DropDatabase(name string) error {
	db, err := d.connect()
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", name))
	return err
}

func (d *DatabaseClient) DumpDatabase(name string, outputPath string) error {
	// Extract credentials from DSN
	// DSN format: root:password@tcp(host:3306)/
	parts := strings.Split(d.dsn, "@")
	if len(parts) != 2 {
		return fmt.Errorf("invalid DSN format")
	}
	credParts := strings.Split(parts[0], ":")
	if len(credParts) != 2 {
		return fmt.Errorf("invalid credentials in DSN")
	}
	password := credParts[1]

	// Use docker exec to run mysqldump inside the MySQL container
	cmd := exec.Command("docker", "exec", "damp-db", "mysqldump", 
		"-uroot", "-p"+password, 
		"--single-transaction", 
		"--routines", 
		"--triggers",
		name)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("mysqldump failed: %w\nOutput: %s", err, string(output))
	}

	if err := os.WriteFile(outputPath, output, 0644); err != nil {
		return fmt.Errorf("failed to write dump file: %w", err)
	}

	return nil
}

// ── PostgreSQL (via TCP) ──────────────────────────────────

func (p *PostgresClient) connectMaintenance() (*sql.DB, error) {
	return sql.Open("postgres", p.dsn)
}

func (p *PostgresClient) ListDatabases() ([]string, error) {
	db, err := p.connectMaintenance()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var databases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		if !systemPGDBs[name] {
			databases = append(databases, name)
		}
	}
	return databases, nil
}

func (p *PostgresClient) CreateDatabase(name string) error {
	db, err := p.connectMaintenance()
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(fmt.Sprintf("CREATE DATABASE \"%s\"", name))
	return err
}

func (p *PostgresClient) DropDatabase(name string) error {
	db, err := p.connectMaintenance()
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS \"%s\"", name))
	return err
}

// ── Redis (via TCP) ───────────────────────────────────────

type RedisInfo struct {
	Connected bool   `json:"connected"`
	Version   string `json:"version"`
	Keys      string `json:"keys"`
	Memory    string `json:"memory"`
}

func GetRedisInfo(host string) RedisInfo {
	conn, err := net.DialTimeout("tcp", host+":6379", 2*time.Second)
	if err != nil {
		return RedisInfo{Connected: false}
	}
	defer conn.Close()

	info := RedisInfo{Connected: true}

	conn.SetDeadline(time.Now().Add(2 * time.Second))
	fmt.Fprintf(conn, "*2\r\n$4\r\nINFO\r\n$3\r\nall\r\n")

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "redis_version:") {
			info.Version = strings.TrimSpace(strings.TrimPrefix(line, "redis_version:"))
		}
		if strings.HasPrefix(line, "used_memory_human:") {
			info.Memory = strings.TrimSpace(strings.TrimPrefix(line, "used_memory_human:"))
		}
		if strings.HasPrefix(line, "db0:keys=") {
			info.Keys = strings.TrimSpace(line)
		}
		if line == "" && info.Version != "" && info.Memory != "" {
			break
		}
	}

	return info
}

// ── HTTP Handlers ─────────────────────────────────────────

func HandleDatabases(w http.ResponseWriter, r *http.Request, dc *DatabaseClient, pg *PostgresClient) {
	engine := r.URL.Query().Get("engine")

	switch r.Method {
	case http.MethodGet:
		if engine == "postgres" {
			dbs, err := pg.ListDatabases()
			if err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
			jsonResponse(w, dbs)
			return
		}
		dbs, err := dc.ListDatabases()
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, dbs)

	case http.MethodPost:
		var body struct {
			Name   string `json:"name"`
			Engine string `json:"engine"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			jsonError(w, "Invalid name", http.StatusBadRequest)
			return
		}
		if !validDBName.MatchString(body.Name) {
			jsonError(w, "Invalid database name: use letters, numbers, underscores and hyphens only", http.StatusBadRequest)
			return
		}
		if body.Engine == "postgres" {
			if err := pg.CreateDatabase(body.Name); err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := dc.CreateDatabase(body.Name); err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		jsonResponse(w, map[string]string{"status": "created", "name": body.Name, "engine": body.Engine})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func HandleDatabaseAction(w http.ResponseWriter, r *http.Request, dc *DatabaseClient, pg *PostgresClient) {
	name := strings.TrimPrefix(r.URL.Path, "/api/databases/")
	if name == "" || !validDBName.MatchString(name) {
		jsonError(w, "Invalid database name", http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	engine := r.URL.Query().Get("engine")
	if engine == "postgres" {
		if err := pg.DropDatabase(name); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		if err := dc.DropDatabase(name); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	jsonResponse(w, map[string]string{"status": "dropped", "name": name})
}

func HandleRedis(w http.ResponseWriter, r *http.Request, host string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	jsonResponse(w, GetRedisInfo(host))
}
