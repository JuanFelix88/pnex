mod config;
mod pty;

use config::{AppConfig, ConfigStore};
use pty::{PtyState, TerminalSize, TerminalStarted};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::{
    ipc::{Channel, InvokeBody, Request, Response},
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(1);

#[derive(Default)]
struct WindowStartDirectories(Mutex<HashMap<String, String>>);

impl WindowStartDirectories {
    fn set(&self, window_label: String, directory: String) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Window directory state is unavailable.".to_owned())?
            .insert(window_label, directory);
        Ok(())
    }

    fn take(&self, window_label: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "Window directory state is unavailable.".to_owned())?
            .remove(window_label))
    }

    fn remove(&self, window_label: &str) {
        if let Ok(mut directories) = self.0.lock() {
            directories.remove(window_label);
        }
    }
}

#[tauri::command]
fn get_config(state: State<'_, ConfigStore>) -> Result<AppConfig, String> {
    state.get()
}

#[tauri::command]
fn save_config(state: State<'_, ConfigStore>, config: AppConfig) -> Result<(), String> {
    state.save(config)
}

#[tauri::command]
fn open_config(app: AppHandle, state: State<'_, ConfigStore>) -> Result<(), String> {
    app.opener()
        .open_path(state.path().to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_terminal(
    window: WebviewWindow,
    state: State<'_, PtyState>,
    config_store: State<'_, ConfigStore>,
    directories: State<'_, WindowStartDirectories>,
    size: TerminalSize,
    output: Channel<Response>,
) -> Result<TerminalStarted, String> {
    let config = config_store.get()?;
    let start_directory = directories
        .take(window.label())?
        .unwrap_or(config.start_directory);
    state.start(
        window,
        output,
        size,
        &config.shell,
        &start_directory,
        config_store.home_directory(),
    )
}

#[tauri::command]
fn write_terminal(
    window: WebviewWindow,
    state: State<'_, PtyState>,
    request: Request<'_>,
) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(data) => state.write(window.label(), data),
        InvokeBody::Json(value) => {
            let data = decode_json_terminal_input(value)?;
            state.write(window.label(), &data)
        }
    }
}

fn decode_json_terminal_input(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    if let Some(data) = value.get("data").and_then(serde_json::Value::as_str) {
        return Ok(data.as_bytes().to_vec());
    }

    serde_json::from_value(value.clone())
        .map_err(|_| "Terminal input must be sent as bytes or a data string.".to_owned())
}

#[tauri::command]
fn resize_terminal(
    window: WebviewWindow,
    state: State<'_, PtyState>,
    size: TerminalSize,
) -> Result<(), String> {
    state.resize(window.label(), size)
}

#[tauri::command]
fn stop_terminal(window: WebviewWindow, state: State<'_, PtyState>) {
    state.stop(window.label());
}

#[tauri::command]
async fn new_window(
    app: AppHandle,
    window: WebviewWindow,
    directories: State<'_, WindowStartDirectories>,
    inherited_directory: Option<String>,
) -> Result<(), String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let width = f64::from(size.width) / scale_factor;
    let height = f64::from(size.height) / scale_factor;
    let id = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let label = format!("pnex-window-{id}");
    let directory = inherited_directory.map(validate_directory).transpose()?;

    if let Some(directory) = directory {
        directories.set(label.clone(), directory)?;
    }

    match WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App("index.html".into()))
        .title("pnex")
        .inner_size(width, height)
        .min_inner_size(260.0, 120.0)
        .resizable(true)
        .decorations(false)
        .build()
    {
        Ok(_) => Ok(()),
        Err(error) => {
            directories.remove(&label);
            Err(error.to_string())
        }
    }
}

fn validate_directory(directory: String) -> Result<String, String> {
    let directory = fs::canonicalize(normalize_directory(&directory))
        .map_err(|_| "The inherited directory is no longer available.".to_owned())?;
    if !directory.is_dir() {
        return Err("The inherited path is not a directory.".to_owned());
    }
    Ok(shell_directory(&directory))
}

#[cfg(target_os = "windows")]
fn shell_directory(directory: &std::path::Path) -> String {
    let directory = directory.to_string_lossy();
    if let Some(directory) = directory.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{directory}")
    } else {
        directory
            .strip_prefix(r"\\?\")
            .unwrap_or(&directory)
            .to_owned()
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_directory(directory: &std::path::Path) -> String {
    directory.to_string_lossy().into_owned()
}

#[cfg(target_os = "windows")]
fn normalize_directory(directory: &str) -> String {
    let directory = directory.trim();
    let bytes = directory.as_bytes();
    let (drive, suffix) = match bytes {
        [b'/', drive] if drive.is_ascii_alphabetic() => (char::from(*drive), ""),
        [b'/', drive, b'/', suffix @ ..] if drive.is_ascii_alphabetic() => (
            char::from(*drive),
            std::str::from_utf8(suffix).unwrap_or_default(),
        ),
        [b'/', b'm', b'n', b't', b'/', drive, b'/', suffix @ ..]
            if drive.is_ascii_alphabetic() =>
        {
            (
                char::from(*drive),
                std::str::from_utf8(suffix).unwrap_or_default(),
            )
        }
        [b'/', b'c', b'y', b'g', b'd', b'r', b'i', b'v', b'e', b'/', drive, b'/', suffix @ ..]
            if drive.is_ascii_alphabetic() =>
        {
            (
                char::from(*drive),
                std::str::from_utf8(suffix).unwrap_or_default(),
            )
        }
        _ => return directory.to_owned(),
    };

    let suffix = suffix.replace('/', "\\");
    if suffix.is_empty() {
        format!("{}:\\", drive.to_ascii_uppercase())
    } else {
        format!("{}:\\{suffix}", drive.to_ascii_uppercase())
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_directory(directory: &str) -> String {
    directory.to_owned()
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn toggle_devtools(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[derive(Default, Serialize)]
struct GitContext {
    branch: String,
    user: String,
}

#[tauri::command]
async fn get_git_context(cwd: String) -> GitContext {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(branch) = git_output(&cwd, &["branch", "--show-current"]) else {
            return GitContext::default();
        };
        let user = git_output(&cwd, &["config", "--local", "user.name"]).unwrap_or_default();
        GitContext { branch, user }
    })
    .await
    .unwrap_or_default()
}

fn git_output(cwd: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(cwd);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::WindowStartDirectories;

    #[cfg(target_os = "windows")]
    #[test]
    fn converts_msys_directories_for_windows() {
        assert_eq!(super::normalize_directory("/c/www/pnex"), "C:\\www\\pnex");
        assert_eq!(
            super::normalize_directory("/mnt/c/www/pnex"),
            "C:\\www\\pnex"
        );
        assert_eq!(
            super::normalize_directory("/cygdrive/c/www/pnex"),
            "C:\\www\\pnex"
        );
        assert_eq!(super::normalize_directory("/c"), "C:\\");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn removes_windows_verbatim_prefix_before_starting_the_shell() {
        assert_eq!(
            super::shell_directory(std::path::Path::new(r"\\?\C:\www\pnex")),
            r"C:\www\pnex"
        );
        assert_eq!(
            super::shell_directory(std::path::Path::new(r"\\?\UNC\server\share\pnex")),
            r"\\server\share\pnex"
        );
    }

    #[test]
    fn decodes_json_byte_input() {
        assert_eq!(
            super::decode_json_terminal_input(&serde_json::json!([112, 110, 101, 120]))
                .expect("byte input"),
            b"pnex"
        );
    }

    #[test]
    fn decodes_legacy_string_input() {
        assert_eq!(
            super::decode_json_terminal_input(&serde_json::json!({ "data": "pnex" }))
                .expect("legacy input"),
            b"pnex"
        );
    }

    #[test]
    fn inherited_directory_is_consumed_when_terminal_starts() {
        let directories = WindowStartDirectories::default();
        directories
            .set("pnex-window-1".to_owned(), "C:\\workspace".to_owned())
            .expect("directory state");

        assert_eq!(
            directories.take("pnex-window-1").expect("directory state"),
            Some("C:\\workspace".to_owned())
        );
        assert_eq!(
            directories.take("pnex-window-1").expect("directory state"),
            None
        );
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let home_directory = app.path().home_dir().map_err(|error| error.to_string())?;
            app.manage(ConfigStore::load(home_directory)?);
            Ok(())
        })
        .manage(PtyState::default())
        .manage(WindowStartDirectories::default())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            open_config,
            start_terminal,
            write_terminal,
            resize_terminal,
            stop_terminal,
            toggle_devtools,
            new_window,
            close_app,
            get_git_context
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                window.state::<PtyState>().stop(window.label());
                window
                    .state::<WindowStartDirectories>()
                    .remove(window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running pnex");
}
