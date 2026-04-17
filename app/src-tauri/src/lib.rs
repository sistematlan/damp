use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::Command;
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
    engine: String, // "mysql" or "postgres"
}

#[derive(Serialize, Clone)]
pub struct DampStatus {
    docker_running: bool,
    docker_installed: bool,
    orbstack_installed: bool,
    damp_path: String,
    containers: Vec<Container>,
    databases: Vec<Database>,
}

/// Resolve DAMP root directory.
/// Priority: DAMP_PATH env var → parent of the app directory → fallback.
fn resolve_damp_path() -> PathBuf {
    if let Ok(p) = env::var("DAMP_PATH") {
        return PathBuf::from(p);
    }

    // The app lives at <damp>/app, so the parent/core is the DAMP root
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
    for p in ["/usr/local/bin/docker", "/usr/bin/docker", "docker"] {
        if Command::new(p).arg("--version").output().is_ok() {
            return p.to_string();
        }
    }
    "docker".to_string()
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
fn get_status() -> DampStatus {
    let damp_path = resolve_damp_path();
    let docker_bin = get_docker_path();

    let docker_installed = Command::new(&docker_bin).arg("--version").output().is_ok();
    let orbstack_installed = PathBuf::from("/Applications/OrbStack.app").exists();

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
    let mut db_list = Vec::new();

    if docker_running {
        // Use a more robust ps command
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
                        status: parts[1].to_string(), // "running", "exited", etc.
                        is_damp: parts[0].starts_with("damp-"),
                    });
                }
            }
        }

        // Get MySQL databases only if damp-db is running
        if container_list
            .iter()
            .any(|c| c.name == "damp-db" && c.status == "running")
        {
            let mysql_out = Command::new(&docker_bin)
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
                .output();

            if let Ok(o) = mysql_out {
                let stdout = String::from_utf8_lossy(&o.stdout);
                for line in stdout.lines() {
                    let db = line.trim();
                    if !db.is_empty()
                        && !matches!(
                            db,
                            "information_schema" | "mysql" | "performance_schema" | "sys"
                        )
                    {
                        db_list.push(Database {
                            name: db.to_string(),
                            engine: "mysql".to_string(),
                        });
                    }
                }
            }
        }
    }

    DampStatus {
        docker_running,
        docker_installed,
        orbstack_installed,
        damp_path: damp_path.display().to_string(),
        containers: container_list,
        databases: db_list,
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
                    format!("MySQL Database '{}' created", name)
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
                    format!("Postgres Database '{}' created", name)
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
                    format!("MySQL Database '{}' dropped", name)
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
                    format!("Postgres Database '{}' dropped", name)
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
    let damp_script = damp_path.join("damp");
    let docker_bin = get_docker_path();
    let project_path = damp_path.join(&name);

    // 1. Create project files
    let output = Command::new("bash")
        .arg(damp_script)
        .arg("new")
        .arg(template)
        .arg(&name)
        .current_dir(&damp_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // 2. Start the project automatically
    let _ = Command::new(&docker_bin)
        .args(["compose", "up", "-d"])
        .current_dir(&project_path)
        .output();

    Ok(format!("Project '{}' created and started", name))
}

#[derive(Serialize, serde::Deserialize, Clone)]
pub struct Project {
    name: String,
    path: String,
    template: String,
}

fn get_registry_path() -> PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
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

    // 1. Copy template files
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

    // 2. Generate Caddy config for this project
    // We assume the project runs on port 80 inside its own container (standard in our templates)
    let tld = env::var("DAMP_TLD").unwrap_or_else(|_| "test".to_string());
    let caddy_conf = format!(
        "{}.{} {{\n    reverse_proxy {}-app:80\n}}\n",
        project_name, tld, project_name
    );
    let caddy_file_path = damp_path
        .join("caddy")
        .join("projects.d")
        .join(format!("{}.caddy", project_name));
    std::fs::write(caddy_file_path, caddy_conf).map_err(|e| e.to_string())?;

    // 3. Reload Caddy via damp script
    let damp_script = damp_path.join("bin").join("damp");
    let _ = Command::new("bash")
        .arg(damp_script)
        .arg("reload")
        .current_dir(&damp_path)
        .output();

    // 4. Register in projects.json
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
    let mut suggestion = "frankenphp".to_string(); // Default

    // Logic to detect project type
    if p.join("wp-config.php").exists() || p.join("wp-content").exists() {
        suggestion = "wordpress".to_string();
        detected_files.push("WordPress files found".to_string());
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

            // --- System Tray ---
            let quit_i = MenuItem::with_id(app, "quit", "Quit DAMP", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let start_i = MenuItem::with_id(app, "start", "Start DAMP", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Stop DAMP", true, None::<&str>)?;
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
                        let _ = open_url("http://localhost:8080".to_string());
                    }
                    "mail" => {
                        let _ = open_url("http://localhost:8025".to_string());
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
            create_database,
            drop_database,
            open_url,
            get_templates,
            create_project,
            get_projects,
            detect_project_type,
            adopt_project,
            add_project,
            remove_project,
            start_project,
            stop_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
