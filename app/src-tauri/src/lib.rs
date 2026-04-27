use serde::{Deserialize, Serialize};
use std::env;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct Container {
    name: String,
    status: String,
    is_damp: bool,
}

#[derive(Serialize, Clone)]
pub struct Database {
    name: String,
    engine: String,
}

#[derive(Serialize, Clone)]
pub struct RedisInfo {
    connected: bool,
    version: String,
    memory: String,
    keys: i64,
}

#[derive(Serialize, Clone)]
pub struct DampStatus {
    docker_running: bool,
    docker_installed: bool,
    docker_desktop_installed: bool,
    damp_path: String,
    tld: String,
    containers: Vec<Container>,
    databases: Vec<Database>,
    postgres_databases: Vec<Database>,
    redis: RedisInfo,
}

fn resolve_damp_path() -> PathBuf {
    if let Ok(p) = env::var("DAMP_PATH") {
        return PathBuf::from(p);
    }

    if let Ok(exe) = env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..10 {
            if let Some(ref d) = dir {
                if d.join("core").join("docker-compose.yml").exists() {
                    return d.join("core");
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }

    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("core")
}

fn get_docker_path() -> String {
    #[cfg(target_os = "windows")]
    {
        // Docker Desktop for Windows paths
        let windows_paths = [
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
            r"C:\ProgramData\DockerDesktop\version-bin\docker.exe",
        ];
        for p in &windows_paths {
            if std::path::Path::new(p).exists() {
                return p.to_string();
            }
        }
        // Try docker.exe in PATH
        if Command::new("docker.exe").arg("--version").output().is_ok() {
            return "docker.exe".to_string();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for p in ["/usr/local/bin/docker", "/usr/bin/docker", "docker"] {
            if Command::new(p).arg("--version").output().is_ok() {
                return p.to_string();
            }
        }
    }
    "docker".to_string()
}

fn is_docker_desktop_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Applications/Docker.app").exists()
            || PathBuf::from("/Applications/OrbStack.app").exists()
    }
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(r"C:\Program Files\Docker\Docker\Docker Desktop.exe").exists()
            || PathBuf::from(r"C:\ProgramData\DockerDesktop\Docker Desktop.exe").exists()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux: check for docker-desktop or standard docker
        Command::new("docker").arg("--version").output().is_ok()
    }
}

fn get_tld() -> String {
    let damp_path = resolve_damp_path();
    let env_path = damp_path.join(".env");
    if let Ok(content) = std::fs::read_to_string(&env_path) {
        for line in content.lines() {
            if line.starts_with("DAMP_TLD=") {
                return line.trim_start_matches("DAMP_TLD=").trim().to_string();
            }
        }
    }
    env::var("DAMP_TLD").unwrap_or_else(|_| "test".to_string())
}

fn query_redis_info(host: &str, port: u16) -> RedisInfo {
    let addr = format!("{}:{}", host, port);
    let mut stream =
        match TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)) {
            Ok(s) => s,
            Err(_) => {
                return RedisInfo {
                    connected: false,
                    version: String::new(),
                    memory: String::new(),
                    keys: 0,
                }
            }
        };

    let _ = stream.write_all(b"INFO server\r\nDBSIZE\r\n");
    let _ = stream.flush();

    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => {
            return RedisInfo {
                connected: false,
                version: String::new(),
                memory: String::new(),
                keys: 0,
            }
        }
    };

    let info = String::from_utf8_lossy(&buf[..n]);

    let version = info
        .lines()
        .find(|l| l.starts_with("redis_version:"))
        .map(|l| l.trim_start_matches("redis_version:").to_string())
        .unwrap_or_default();

    let memory = info
        .lines()
        .find(|l| l.starts_with("used_memory_human:"))
        .map(|l| l.trim_start_matches("used_memory_human:").to_string())
        .unwrap_or_default();

    let keys_str = info
        .lines()
        .find(|l| l.starts_with("db0:keys="))
        .and_then(|l| {
            let start = l.find("keys=")?;
            let rest = &l[start + 5..];
            let end = rest.find(',').unwrap_or(rest.len());
            Some(rest[..end].to_string())
        })
        .unwrap_or_else(|| "0".to_string());

    let keys: i64 = keys_str.parse().unwrap_or(0);

    let mut stream2 =
        match TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)) {
            Ok(s) => s,
            Err(_) => {
                return RedisInfo {
                    connected: true,
                    version,
                    memory,
                    keys,
                }
            }
        };
    let _ = stream2.write_all(b"DBSIZE\r\n");
    let _ = stream2.flush();
    let mut buf2 = [0u8; 1024];
    let n2 = stream2.read(&mut buf2).unwrap_or(0);
    let resp = String::from_utf8_lossy(&buf2[..n2]);
    let parsed_keys: i64 = resp
        .lines()
        .find(|l| l.starts_with(":"))
        .and_then(|l| l.trim_start_matches(':').trim().parse().ok())
        .unwrap_or(keys);

    RedisInfo {
        connected: true,
        version,
        memory,
        keys: parsed_keys,
    }
}

#[tauri::command]
fn get_status() -> DampStatus {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    let tld = get_tld();

    let docker_installed = Command::new(&docker_bin).arg("--version").output().is_ok();
    let docker_desktop_installed = is_docker_desktop_installed();

    let docker_running = if docker_installed {
        Command::new(&docker_bin)
            .args(["info"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };

    let mut container_list = Vec::new();
    let mut mysql_dbs = Vec::new();
    let mut pg_dbs = Vec::new();
    let redis_info = RedisInfo {
        connected: false,
        version: String::new(),
        memory: String::new(),
        keys: 0,
    };

    if docker_running {
        if let Ok(output) = Command::new(&docker_bin)
            .args(["ps", "-a", "--format", "{{.Names}}|{{.State}}"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split('|').collect();
                if parts.len() == 2 {
                    container_list.push(Container {
                        name: parts[0].to_string(),
                        status: parts[1].to_string(),
                        is_damp: parts[0].starts_with("damp-"),
                    });
                }
            }
        }

        if container_list
            .iter()
            .any(|c| c.name == "damp-db" && c.status == "running")
        {
            if let Ok(o) = Command::new(&docker_bin)
                .args([
                    "exec",
                    "damp-db",
                    "mysql",
                    "-uroot",
                    "-proot",
                    "-N",
                    "-e",
                    "SHOW DATABASES;",
                ])
                .output()
            {
                let stdout = String::from_utf8_lossy(&o.stdout);
                for line in stdout.lines() {
                    let db = line.trim();
                    if !db.is_empty()
                        && !matches!(
                            db,
                            "information_schema" | "mysql" | "performance_schema" | "sys"
                        )
                    {
                        mysql_dbs.push(Database {
                            name: db.to_string(),
                            engine: "mysql".to_string(),
                        });
                    }
                }
            }
        }

        if container_list
            .iter()
            .any(|c| c.name == "damp-postgres" && c.status == "running")
        {
            if let Ok(o) = Command::new(&docker_bin)
                .args([
                    "exec",
                    "damp-postgres",
                    "psql",
                    "-U",
                    "root",
                    "-t",
                    "-c",
                    "SELECT datname FROM pg_database WHERE datistemplate = false;",
                ])
                .output()
            {
                let stdout = String::from_utf8_lossy(&o.stdout);
                for line in stdout.lines() {
                    let db = line.trim();
                    if !db.is_empty() {
                        pg_dbs.push(Database {
                            name: db.to_string(),
                            engine: "postgres".to_string(),
                        });
                    }
                }
            }
        }
    }

    let redis = if docker_running
        && container_list
            .iter()
            .any(|c| c.name == "damp-redis" && c.status == "running")
    {
        let host = env::var("REDIS_HOST").unwrap_or_else(|_| "localhost".to_string());
        query_redis_info(&host, 6379)
    } else {
        redis_info
    };

    DampStatus {
        docker_running,
        docker_installed,
        docker_desktop_installed,
        damp_path: damp_path.display().to_string(),
        tld,
        containers: container_list,
        databases: mysql_dbs,
        postgres_databases: pg_dbs,
        redis,
    }
}

#[tauri::command]
fn damp_up() -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["compose", "up", "-d"])
        .current_dir(&damp_path)
        .output()
        .map(|o| {
            if o.status.success() {
                "DAMP started".to_string()
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn damp_down() -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["compose", "down"])
        .current_dir(&damp_path)
        .output()
        .map(|o| {
            if o.status.success() {
                "DAMP stopped".to_string()
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn damp_restart() -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["compose", "restart"])
        .current_dir(&damp_path)
        .output()
        .map(|o| {
            if o.status.success() {
                "DAMP restarted".to_string()
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_project(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Project path not found".to_string());
    }
    let output = Command::new("docker")
        .args(["compose", "up", "-d"])
        .current_dir(&p)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok("Project started".to_string())
}

#[tauri::command]
fn stop_project(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Project path not found".to_string());
    }
    let output = Command::new("docker")
        .args(["compose", "stop"])
        .current_dir(&p)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok("Project stopped".to_string())
}

#[tauri::command]
fn restart_project(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Project path not found".to_string());
    }
    let output = Command::new("docker")
        .args(["compose", "restart"])
        .current_dir(&p)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok("Project restarted".to_string())
}

#[tauri::command]
fn create_database(name: String, engine: String) -> Result<String, String> {
    let docker_bin = get_docker_path();
    if engine == "mysql" {
        let query = format!(
            "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            name
        );
        Command::new(&docker_bin)
            .args(["exec", "damp-db", "mysql", "-uroot", "-proot", "-e", &query])
            .output()
            .map(|o| {
                if o.status.success() {
                    format!("MySQL database '{}' created", name)
                } else {
                    String::from_utf8_lossy(&o.stderr).to_string()
                }
            })
            .map_err(|e| e.to_string())
    } else if engine == "postgres" {
        let query = format!("CREATE DATABASE \"{}\"", name);
        Command::new(&docker_bin)
            .args(["exec", "damp-postgres", "psql", "-U", "root", "-c", &query])
            .output()
            .map(|o| {
                if o.status.success() {
                    format!("Postgres database '{}' created", name)
                } else {
                    String::from_utf8_lossy(&o.stderr).to_string()
                }
            })
            .map_err(|e| e.to_string())
    } else {
        Err("Unsupported database engine".to_string())
    }
}

#[tauri::command]
fn drop_database(name: String, engine: String) -> Result<String, String> {
    let docker_bin = get_docker_path();
    if engine == "mysql" {
        let query = format!("DROP DATABASE IF EXISTS `{}`", name);
        Command::new(&docker_bin)
            .args(["exec", "damp-db", "mysql", "-uroot", "-proot", "-e", &query])
            .output()
            .map(|o| {
                if o.status.success() {
                    format!("MySQL database '{}' dropped", name)
                } else {
                    String::from_utf8_lossy(&o.stderr).to_string()
                }
            })
            .map_err(|e| e.to_string())
    } else if engine == "postgres" {
        let query = format!("DROP DATABASE \"{}\"", name);
        Command::new(&docker_bin)
            .args(["exec", "damp-postgres", "psql", "-U", "root", "-c", &query])
            .output()
            .map(|o| {
                if o.status.success() {
                    format!("Postgres database '{}' dropped", name)
                } else {
                    String::from_utf8_lossy(&o.stderr).to_string()
                }
            })
            .map_err(|e| e.to_string())
    } else {
        Err("Unsupported database engine".to_string())
    }
}

#[tauri::command]
fn start_container(name: String) -> Result<String, String> {
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["start", &name])
        .output()
        .map(|o| {
            if o.status.success() {
                format!("Container '{}' started", name)
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_container(name: String) -> Result<String, String> {
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["stop", &name])
        .output()
        .map(|o| {
            if o.status.success() {
                format!("Container '{}' stopped", name)
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn restart_container(name: String) -> Result<String, String> {
    let docker_bin = get_docker_path();
    Command::new(&docker_bin)
        .args(["restart", &name])
        .output()
        .map(|o| {
            if o.status.success() {
                format!("Container '{}' restarted", name)
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_container_logs(name: String, tail: Option<u32>) -> Result<String, String> {
    let docker_bin = get_docker_path();
    let tail_val = tail.unwrap_or(200);
    Command::new(&docker_bin)
        .args(["logs", "--tail", &tail_val.to_string(), &name])
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n{}", stdout, stderr)
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        // Use `start` command via cmd.exe for reliable URL opening on Windows
        Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_templates() -> Vec<String> {
    let damp_path = resolve_damp_path();
    let templates_dir = damp_path.join("templates");
    if let Ok(entries) = std::fs::read_dir(templates_dir) {
        entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect()
    } else {
        vec![]
    }
}

#[tauri::command]
fn create_project(name: String, template: String) -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    let templates_dir = damp_path.join("templates").join(&template);
    let project_path = damp_path.join(&name);
    let tld = get_tld();

    if !templates_dir.exists() {
        return Err(format!("Template '{}' not found", template));
    }

    // 1. Create project directory and copy template files
    std::fs::create_dir_all(&project_path).map_err(|e| e.to_string())?;
    copy_dir_all(&templates_dir, &project_path).map_err(|e| e.to_string())?;

    // 2. Replace PROJECT_NAME in all files
    replace_in_dir(&project_path, "PROJECT_NAME", &name).map_err(|e| e.to_string())?;

    // 3. Create database
    let db_name = name.replace('-', "_");
    let _ = Command::new(&docker_bin)
        .args([
            "exec", "damp-db", "mysql", "-uroot", "-proot", "-e",
            &format!(
                "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
                db_name
            ),
        ])
        .output();

    // 4. Generate Caddy config
    let caddy_dir = damp_path.join("caddy").join("projects.d");
    std::fs::create_dir_all(&caddy_dir).map_err(|e| e.to_string())?;
    let domain = format!("{}.{}", name, tld);
    let caddy_config = format!("{} {{\n    reverse_proxy {}-app:80\n}}\n", domain, name);
    let caddy_file = caddy_dir.join(format!("{}.caddy", name));
    std::fs::write(&caddy_file, caddy_config).map_err(|e| e.to_string())?;

    // 5. Reload Caddy
    let _ = Command::new(&docker_bin)
        .args(["compose", "up", "-d", "caddy", "--force-recreate"])
        .current_dir(&damp_path)
        .output();

    // 6. Start project containers
    let _ = Command::new(&docker_bin)
        .args(["compose", "up", "-d"])
        .current_dir(&project_path)
        .output();

    // 7. Register project
    let _ = add_project(name.clone(), project_path.display().to_string(), template);

    Ok(format!("Project '{}' created and started at https://{}", name, domain))
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn replace_in_dir(dir: &PathBuf, from: &str, to: &str) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            replace_in_dir(&path, from, to)?;
        } else {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let new_content = content.replace(from, to);
                if new_content != content {
                    std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    name: String,
    path: String,
    template: String,
}

fn get_registry_path() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".damp").join("projects.json")
}

fn load_projects_registry() -> Vec<Project> {
    let path = get_registry_path();
    if let Ok(content) = std::fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    }
}

fn save_projects_registry(projects: &Vec<Project>) -> Result<(), String> {
    let path = get_registry_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_projects() -> Vec<Project> {
    load_projects_registry()
}

#[tauri::command]
fn add_project(name: String, path: String, template: String) -> Result<String, String> {
    let mut projects = load_projects_registry();
    if projects.iter().any(|p| p.path == path) {
        return Err("Project already exists in registry".to_string());
    }
    projects.push(Project {
        name,
        path: path.clone(),
        template,
    });
    save_projects_registry(&projects)?;
    Ok(format!("Project '{}' added to DAMP", path))
}

#[tauri::command]
fn remove_project(path: String) -> Result<String, String> {
    let mut projects = load_projects_registry();
    projects.retain(|p| p.path != path);
    save_projects_registry(&projects)?;
    Ok("Project removed from DAMP (files kept)".to_string())
}

#[tauri::command]
fn delete_project(path: String) -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();
    let project_path = PathBuf::from(&path);
    let project_name = project_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let _ = Command::new(&docker_bin)
        .args(["compose", "down"])
        .current_dir(&project_path)
        .output();

    let caddy_file = damp_path
        .join("caddy")
        .join("projects.d")
        .join(format!("{}.caddy", project_name));
    let _ = std::fs::remove_file(caddy_file);

    let db_name = project_name.replace('-', "_");
    let _ = Command::new(&docker_bin)
        .args([
            "exec",
            "damp-db",
            "mysql",
            "-uroot",
            "-proot",
            "-e",
            &format!("DROP DATABASE IF EXISTS `{}`", db_name),
        ])
        .output();
    let _ = Command::new(&docker_bin)
        .args([
            "exec",
            "damp-postgres",
            "psql",
            "-U",
            "root",
            "-c",
            &format!("DROP DATABASE IF EXISTS \"{}\"", db_name),
        ])
        .output();

    // Reload Caddy (cross-platform replacement for `damp reload`)
    let _ = Command::new(&docker_bin)
        .args(["compose", "up", "-d", "caddy", "--force-recreate"])
        .current_dir(&damp_path)
        .output();

    let mut projects = load_projects_registry();
    projects.retain(|p| p.path != path);
    save_projects_registry(&projects)?;

    Ok(format!("Project '{}' fully deleted", project_name))
}

#[tauri::command]
fn adopt_project(path: String, template: String) -> Result<String, String> {
    let damp_path = resolve_damp_path();
    let project_path = PathBuf::from(&path);
    let template_path = damp_path.join("templates").join(&template);

    if !template_path.exists() {
        return Err(format!("Template '{}' not found", template));
    }

    let project_name = project_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let entries = std::fs::read_dir(&template_path).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name();
        let target = project_path.join(&name);
        if !target.exists() {
            if entry.path().is_dir() {
                let _ = std::fs::create_dir_all(&target);
                for sub in std::fs::read_dir(entry.path())
                    .unwrap()
                    .filter_map(|e| e.ok())
                {
                    let _ = std::fs::copy(sub.path(), target.join(sub.file_name()));
                }
            } else {
                std::fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
            }
        }
    }

    let tld = get_tld();
    let caddy_conf = format!(
        "{}.{} {{\n    reverse_proxy {}-app:80\n}}\n",
        project_name, tld, project_name
    );
    let caddy_file_path = damp_path
        .join("caddy")
        .join("projects.d")
        .join(format!("{}.caddy", project_name));
    std::fs::write(caddy_file_path, caddy_conf).map_err(|e| e.to_string())?;

    // Reload Caddy (cross-platform replacement for `damp reload`)
    let docker_bin = get_docker_path();
    let _ = Command::new(&docker_bin)
        .args(["compose", "up", "-d", "caddy", "--force-recreate"])
        .current_dir(&damp_path)
        .output();

    add_project(project_name.clone(), path.clone(), template.clone())?;

    Ok(format!(
        "Project '{}' is now live at https://{}.{}",
        project_name, project_name, tld
    ))
}

#[derive(Serialize, Clone)]
pub struct ProjectSuggestion {
    path: String,
    suggested_template: String,
    detected_files: Vec<String>,
}

#[tauri::command]
fn detect_project_type(path: String) -> Result<ProjectSuggestion, String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return Err("Path does not exist or is not a directory".to_string());
    }

    let mut detected_files = Vec::new();
    let mut suggestion = "frankenphp".to_string();

    if p.join("wp-config.php").exists() || p.join("wp-content").exists() {
        suggestion = "wordpress".to_string();
        detected_files.push("WordPress files found".to_string());
    } else if let Ok(content) = std::fs::read_to_string(p.join("composer.json")) {
        let json: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
        let req = json.get("require").unwrap_or(&serde_json::Value::Null);
        if req.get("laravel/framework").is_some() {
            suggestion = "frankenphp".to_string();
            detected_files.push("Laravel detected (composer.json)".to_string());
        } else if req.get("codeigniter4/framework").is_some()
            || req.get("codeigniter4/codeigniter4").is_some()
        {
            suggestion = "frankenphp".to_string();
            detected_files.push("CodeIgniter 4 detected (composer.json)".to_string());
        } else if req.get("symfony/symfony").is_some()
            || req.get("symfony/framework-bundle").is_some()
        {
            suggestion = "frankenphp".to_string();
            detected_files.push("Symfony detected (composer.json)".to_string());
        }
        if detected_files.is_empty() {
            detected_files.push("composer.json found".to_string());
        }
    } else if p.join("package.json").exists() {
        suggestion = "node".to_string();
        detected_files.push("package.json found".to_string());
    } else if p.join("index.php").exists() {
        suggestion = "php-fpm".to_string();
        detected_files.push("index.php found".to_string());
    }

    Ok(ProjectSuggestion {
        path,
        suggested_template: suggestion,
        detected_files,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let tld = get_tld();

            let quit_i = MenuItem::with_id(app, "quit", "Quit DAMP", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show DAMP", true, None::<&str>)?;
            let start_i = MenuItem::with_id(app, "start", "Start Engine", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Stop Engine", true, None::<&str>)?;
            let pma_i = MenuItem::with_id(app, "pma", "Open PHPMyAdmin", true, None::<&str>)?;
            let mail_i = MenuItem::with_id(app, "mail", "Open Mailpit", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &show_i,
                    &PredefinedMenuItem::separator(app)?,
                    &start_i,
                    &stop_i,
                    &PredefinedMenuItem::separator(app)?,
                    &pma_i,
                    &mail_i,
                    &PredefinedMenuItem::separator(app)?,
                    &quit_i,
                ],
            )?;

            let tld_for_tray = tld.clone();
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "start" => {
                        let _ = damp_up();
                    }
                    "stop" => {
                        let _ = damp_down();
                    }
                    "pma" => {
                        let _ = open_url(format!("https://pma.{}", tld_for_tray));
                    }
                    "mail" => {
                        let _ = open_url(format!("https://mail.{}", tld_for_tray));
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            damp_up,
            damp_down,
            damp_restart,
            start_project,
            stop_project,
            restart_project,
            create_database,
            drop_database,
            start_container,
            stop_container,
            restart_container,
            get_container_logs,
            open_url,
            get_templates,
            create_project,
            get_projects,
            detect_project_type,
            adopt_project,
            add_project,
            remove_project,
            delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
