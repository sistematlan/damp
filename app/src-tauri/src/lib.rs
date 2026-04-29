use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Command;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Container {
    name: String,
    status: String,
    state: String,
    image: String,
    is_damp: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Database {
    name: String,
    engine: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RedisInfo {
    connected: bool,
    version: String,
    memory: String,
    keys: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DampStatus {
    docker_running: bool,
    #[serde(default)]
    docker_installed: bool,
    #[serde(default)]
    docker_desktop_installed: bool,
    #[serde(default)]
    damp_path: String,
    #[serde(default)]
    tld: String,
    containers: Vec<Container>,
    databases: Vec<Database>,
    postgres_databases: Vec<Database>,
    redis: RedisInfo,
}

#[derive(Deserialize, Debug)]
struct GoStatus {
    docker_running: bool,
    containers: Vec<Container>,
    databases: Vec<String>,
    postgres_databases: Vec<String>,
    redis: RedisInfo,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    name: String,
    domain: String,
    status: String,
    template: String,
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

#[tauri::command]
async fn get_status() -> Result<DampStatus, String> {
    let client = reqwest::Client::new();
    let resp = client.get("http://localhost:9000/api/status").send().await;

    match resp {
        Ok(r) => {
            let go_status: GoStatus = r.json().await.map_err(|e| e.to_string())?;
            
            let mysql_dbs = go_status.databases.into_iter().map(|name| Database {
                name,
                engine: "mysql".to_string(),
            }).collect();
            
            let pg_dbs = go_status.postgres_databases.into_iter().map(|name| Database {
                name,
                engine: "postgres".to_string(),
            }).collect();

            Ok(DampStatus {
                docker_running: go_status.docker_running,
                docker_installed: Command::new(get_docker_path()).arg("--version").output().is_ok(),
                docker_desktop_installed: is_docker_desktop_installed(),
                damp_path: resolve_damp_path().display().to_string(),
                tld: get_tld(),
                containers: go_status.containers,
                databases: mysql_dbs,
                postgres_databases: pg_dbs,
                redis: go_status.redis,
            })
        }
        Err(_) => {
            // Backend not yet ready or error
            Ok(DampStatus {
                docker_running: false,
                docker_installed: Command::new(get_docker_path()).arg("--version").output().is_ok(),
                docker_desktop_installed: is_docker_desktop_installed(),
                damp_path: resolve_damp_path().display().to_string(),
                tld: get_tld(),
                containers: vec![],
                databases: vec![],
                postgres_databases: vec![],
                redis: RedisInfo {
                    connected: false,
                    version: "".to_string(),
                    memory: "".to_string(),
                    keys: "".to_string(),
                },
            })
        }
    }
}

#[tauri::command]
async fn damp_up() -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.post("http://localhost:9000/api/engine/up").send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok("DAMP started".to_string())
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error starting DAMP".to_string()))
    }
}

#[tauri::command]
async fn damp_down() -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.post("http://localhost:9000/api/engine/down").send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok("DAMP stopped".to_string())
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error stopping DAMP".to_string()))
    }
}

#[tauri::command]
async fn damp_restart() -> Result<String, String> {
    let client = reqwest::Client::new();
    // Go doesn't have a direct restart endpoint for the engine yet, so we just do up again (which is usually fine with compose up -d)
    let _ = client.post("http://localhost:9000/api/engine/down").send().await;
    let resp = client.post("http://localhost:9000/api/engine/up").send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok("DAMP restarted".to_string())
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error restarting DAMP".to_string()))
    }
}

#[tauri::command]
async fn start_project(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/projects/{}/start", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Project '{}' started", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error starting project".to_string()))
    }
}

#[tauri::command]
async fn stop_project(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/projects/{}/stop", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Project '{}' stopped", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error stopping project".to_string()))
    }
}

#[tauri::command]
async fn restart_project(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/projects/{}/restart", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Project '{}' restarted", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error restarting project".to_string()))
    }
}

#[tauri::command]
async fn create_database(name: String, engine: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.post("http://localhost:9000/api/databases")
        .json(&serde_json::json!({ "name": name, "engine": engine }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if resp.status().is_success() {
        Ok(format!("Database '{}' created", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error creating database".to_string()))
    }
}

#[tauri::command]
async fn drop_database(name: String, engine: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/databases/{}?engine={}", name, engine);
    let resp = client.delete(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Database '{}' dropped", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error dropping database".to_string()))
    }
}

#[tauri::command]
async fn start_container(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/containers/{}/start", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Container '{}' started", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error starting container".to_string()))
    }
}

#[tauri::command]
async fn stop_container(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/containers/{}/stop", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Container '{}' stopped", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error stopping container".to_string()))
    }
}

#[tauri::command]
async fn restart_container(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/containers/{}/restart", name);
    let resp = client.post(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(format!("Container '{}' restarted", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error restarting container".to_string()))
    }
}

#[tauri::command]
async fn get_container_logs(name: String, _tail: Option<u32>) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/containers/{}/logs", name);
    // Note: Go returns logs as SSE or plain text depending on how it's called.
    // For a single fetch, we might need a non-streaming endpoint or handle the stream.
    // The current Go dashboard returns SSE. Let's see if we can just get the tail.
    
    // For now, let's keep the Rust implementation of logs if Go only does SSE,
    // OR update Go to support a plain text log fetch.
    
    // Actually, let's stick with the Rust Command for logs for a moment to avoid complexity 
    // unless we want to implement SSE in the frontend (which is in the backlog!).
    
    let docker_bin = get_docker_path();
    let tail_val = _tail.unwrap_or(200);
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
async fn get_templates() -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::new();
    let templates: Vec<serde_json::Value> = client.get("http://localhost:9000/api/templates")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(templates)
}

#[tauri::command]
async fn create_project(name: String, template: String, path: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.post("http://localhost:9000/api/projects")
        .json(&serde_json::json!({ "name": name, "template": template, "path": path }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if resp.status().is_success() {
        Ok(format!("Project '{}' created", name))
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error creating project".to_string()))
    }
}

#[tauri::command]
async fn get_projects() -> Result<Vec<Project>, String> {
    let client = reqwest::Client::new();
    let projects: Vec<Project> = client.get("http://localhost:9000/api/projects")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(projects)
}

#[tauri::command]
async fn delete_project(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/projects/{}", name);
    let resp = client.delete(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let msg = if let Some(dump) = body.get("dump") {
            format!("Project '{}' deleted. Database backup saved to: {}", name, dump.as_str().unwrap_or(""))
        } else {
            format!("Project '{}' deleted", name)
        };
        Ok(msg)
    } else {
        Err(resp.text().await.unwrap_or_else(|_| "Error deleting project".to_string()))
    }
}

#[tauri::command]
async fn adopt_project(path: String, template: String) -> Result<String, String> {
    // We can reuse the create project logic with the existing path
    create_project(path.split('/').last().unwrap_or("project").to_string(), template, path).await
}

#[tauri::command]
async fn detect_project_type(path: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:9000/api/detect-template?path={}", path);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body)
    } else {
        Err("Error detecting project type".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Spawn sidecar
            let damp_path = resolve_damp_path();
            let sidecar = app.shell().sidecar("damp-dashboard").unwrap()
                .env("DAMP_DIR", damp_path.to_string_lossy().to_string())
                .env("DASHBOARD_PORT", "9000");
            
            let (mut _rx, mut _child) = sidecar.spawn().expect("Failed to spawn sidecar");

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
                        tauri::async_runtime::spawn(async move {
                            let _ = damp_up().await;
                        });
                    }
                    "stop" => {
                        tauri::async_runtime::spawn(async move {
                            let _ = damp_down().await;
                        });
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
            delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
