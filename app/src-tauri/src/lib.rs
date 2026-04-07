use std::env;
use std::path::PathBuf;
use std::process::Command;
use serde::Serialize;

const NETWORK_NAME: &str = "damp";

#[derive(Serialize, Clone)]
pub struct Container {
    name: String,
    status: String,
    is_damp: bool,
}

#[derive(Serialize, Clone)]
pub struct DampStatus {
    docker_running: bool,
    damp_path: String,
    containers: Vec<Container>,
    databases: Vec<String>,
}

/// Resolve DAMP root directory.
/// Priority: DAMP_PATH env var → parent of the app directory → fallback.
fn resolve_damp_path() -> PathBuf {
    if let Ok(p) = env::var("DAMP_PATH") {
        return PathBuf::from(p);
    }

    // The app lives at <damp>/app, so the parent is the DAMP root
    if let Ok(exe) = env::current_exe() {
        // In dev mode the exe is deep in target/, walk up to find docker-compose.yml
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..10 {
            if let Some(ref d) = dir {
                if d.join("docker-compose.yml").exists() {
                    return d.clone();
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }

    // Last resort: current working directory
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
fn get_status() -> DampStatus {
    let damp_path = resolve_damp_path();

    let docker_running = Command::new("docker")
        .args(["info"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !docker_running {
        return DampStatus {
            docker_running: false,
            damp_path: damp_path.display().to_string(),
            containers: vec![],
            databases: vec![],
        };
    }

    // Get containers in the damp network
    let containers = Command::new("docker")
        .args([
            "network", "inspect", NETWORK_NAME,
            "--format", "{{range .Containers}}{{.Name}}|{{end}}",
        ])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let container_list: Vec<Container> = containers
        .split('|')
        .filter(|s| !s.is_empty())
        .map(|name| {
            let name = name.trim().to_string();
            let status = Command::new("docker")
                .args(["inspect", "--format", "{{.State.Status}}", &name])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or("unknown".to_string());
            let is_damp = name.starts_with("damp-");
            Container { name, status, is_damp }
        })
        .collect();

    // Get databases
    let databases = Command::new("docker")
        .args([
            "exec", "damp-db", "mysql", "-uroot", "-proot", "-N", "-e",
            "SHOW DATABASES",
        ])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| {
                    !matches!(*l, "information_schema" | "mysql" | "performance_schema" | "sys")
                })
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    DampStatus {
        docker_running,
        damp_path: damp_path.display().to_string(),
        containers: container_list,
        databases,
    }
}

#[tauri::command]
fn damp_up() -> Result<String, String> {
    let damp_path = resolve_damp_path();
    Command::new("docker")
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
    Command::new("docker")
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
fn create_database(name: String) -> Result<String, String> {
    let query = format!(
        "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
        name
    );
    Command::new("docker")
        .args(["exec", "damp-db", "mysql", "-uroot", "-proot", "-e", &query])
        .output()
        .map(|o| {
            if o.status.success() {
                format!("Database '{}' created", name)
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn drop_database(name: String) -> Result<String, String> {
    let query = format!("DROP DATABASE IF EXISTS `{}`", name);
    Command::new("docker")
        .args(["exec", "damp-db", "mysql", "-uroot", "-proot", "-e", &query])
        .output()
        .map(|o| {
            if o.status.success() {
                format!("Database '{}' dropped", name)
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";

    Command::new(cmd)
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            damp_up,
            damp_down,
            create_database,
            drop_database,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
