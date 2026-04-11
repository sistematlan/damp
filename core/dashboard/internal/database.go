package internal

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	_ "github.com/go-sql-driver/mysql"
)

type DatabaseClient struct {
	dsn string
}

func NewDatabaseClient(host, password string) *DatabaseClient {
	return &DatabaseClient{
		dsn: fmt.Sprintf("root:%s@tcp(%s:3306)/", password, host),
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

// HTTP Handlers

func HandleDatabases(w http.ResponseWriter, r *http.Request, dc *DatabaseClient) {
	switch r.Method {
	case http.MethodGet:
		dbs, err := dc.ListDatabases()
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, dbs)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			jsonError(w, "Invalid name", http.StatusBadRequest)
			return
		}
		if err := dc.CreateDatabase(body.Name); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]string{"status": "created", "name": body.Name})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func HandleDatabaseAction(w http.ResponseWriter, r *http.Request, dc *DatabaseClient) {
	name := strings.TrimPrefix(r.URL.Path, "/api/databases/")
	if name == "" {
		jsonError(w, "Missing database name", http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := dc.DropDatabase(name); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "dropped", "name": name})
}
