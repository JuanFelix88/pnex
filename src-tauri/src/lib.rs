mod config;
pub mod notification;
mod pty;

use config::{AppConfig, ConfigStore, CursorAnimation, LiquidCursorSettings};
use notification::{Notification, NotificationSystem};
use pty::{PtyState, TerminalSize, TerminalStarted};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::{
    ipc::{Channel, InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(1);

#[derive(Default)]
struct WindowStartDirectories(Mutex<HashMap<String, (String, Option<String>)>>);

#[derive(Default)]
struct AppCloseState(Mutex<Option<HashSet<String>>>);

impl WindowStartDirectories {
    fn set(
        &self,
        window_label: String,
        directory: String,
        command: Option<String>,
    ) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Window start state is unavailable.".to_owned())?
            .insert(window_label, (directory, command));
        Ok(())
    }

    fn take(&self, window_label: &str) -> Result<Option<(String, Option<String>)>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "Window start state is unavailable.".to_owned())?
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiquidCursorConfigChanged {
    source_window: String,
    cursor_animation: CursorAnimation,
    liquid_cursor: LiquidCursorSettings,
}

#[tauri::command]
fn save_liquid_cursor(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ConfigStore>,
    cursor_animation: CursorAnimation,
    liquid_cursor: LiquidCursorSettings,
) -> Result<(), String> {
    state.save_liquid_cursor(cursor_animation.clone(), liquid_cursor.clone())?;
    app.emit(
        "liquid-cursor-config-changed",
        LiquidCursorConfigChanged {
            source_window: window.label().to_owned(),
            cursor_animation,
            liquid_cursor,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_config(app: AppHandle, state: State<'_, ConfigStore>) -> Result<(), String> {
    app.opener()
        .open_path(state.path().to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_notification(
    window: WebviewWindow,
    state: State<'_, NotificationSystem>,
    notification: Notification,
) -> Result<(), String> {
    let system = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if notification.should_activate_window_on_click() {
            system
                .notify_with_click_handler(notification, move || activate_window(&window))
                .map_err(|error| error.to_string())
        } else {
            system
                .notify(notification)
                .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
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
    let inherited = directories.take(window.label())?;
    let start_directory = inherited
        .as_ref()
        .map(|(directory, _)| directory.as_str())
        .unwrap_or(&config.start_directory);
    let mut started = state.start(
        window,
        output,
        size,
        &config.shell,
        start_directory,
        config_store.home_directory(),
    )?;
    started.startup_command = inherited.and_then(|(_, command)| command);
    Ok(started)
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

fn activate_window(window: &WebviewWindow) {
    if let Err(error) = window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
    {
        eprintln!("Could not activate notification source window: {error}");
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
    inherited_command: Option<String>,
) -> Result<(), String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let width = f64::from(size.width) / scale_factor;
    let height = f64::from(size.height) / scale_factor;
    let id = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let label = format!("pnex-window-{id}");
    let directory = inherited_directory.map(validate_directory).transpose()?;
    let command = inherited_command.map(validate_command).transpose()?;
    if command.is_some() && directory.is_none() {
        return Err("An inherited command requires an inherited directory.".to_owned());
    }

    if let Some(directory) = directory {
        directories.set(label.clone(), directory, command)?;
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

fn validate_command(command: String) -> Result<String, String> {
    const MAX_COMMAND_BYTES: usize = 32_768;
    let command = command.trim();
    if command.is_empty() || command.len() > MAX_COMMAND_BYTES || command.contains(['\r', '\n']) {
        return Err("The inherited command must be one non-empty line.".to_owned());
    }
    Ok(command.to_owned())
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
        [b'/', b'm', b'n', b't', b'/', drive, b'/', suffix @ ..] if drive.is_ascii_alphabetic() => {
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
fn request_close_app(app: AppHandle, state: State<'_, AppCloseState>) -> Result<(), String> {
    let windows = app.webview_windows().into_keys().collect::<HashSet<_>>();
    if windows.is_empty() {
        app.exit(0);
        return Ok(());
    }

    *state
        .0
        .lock()
        .map_err(|_| "App close state is unavailable.")? = Some(windows);
    if let Err(error) = app.emit("app-close-requested", ()) {
        *state
            .0
            .lock()
            .map_err(|_| "App close state is unavailable.")? = None;
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn confirm_app_close(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppCloseState>,
) -> Result<(), String> {
    let should_exit = {
        let mut pending = state
            .0
            .lock()
            .map_err(|_| "App close state is unavailable.")?;
        let Some(windows) = pending.as_mut() else {
            return Ok(());
        };
        windows.remove(window.label());
        if windows.is_empty() {
            *pending = None;
            true
        } else {
            false
        }
    };
    if should_exit {
        app.exit(0);
    }
    Ok(())
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
            .set(
                "pnex-window-1".to_owned(),
                "C:\\workspace".to_owned(),
                Some("pnpm build".to_owned()),
            )
            .expect("window start state");

        assert_eq!(
            directories
                .take("pnex-window-1")
                .expect("window start state"),
            Some(("C:\\workspace".to_owned(), Some("pnpm build".to_owned())))
        );
        assert_eq!(
            directories
                .take("pnex-window-1")
                .expect("window start state"),
            None
        );
    }

    #[test]
    fn inherited_commands_are_single_line() {
        assert_eq!(
            super::validate_command("  pnpm build  ".to_owned()).expect("command"),
            "pnpm build"
        );
        assert!(super::validate_command("echo one\necho two".to_owned()).is_err());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let home_directory = app.path().home_dir().map_err(|error| error.to_string())?;
            let app_name = app
                .config()
                .product_name
                .clone()
                .unwrap_or_else(|| env!("CARGO_PKG_NAME").to_owned());
            let notification_system =
                NotificationSystem::new(app_name, app.config().identifier.clone(), tauri::is_dev());
            app.manage(ConfigStore::load(home_directory)?);
            app.manage(notification_system);
            Ok(())
        })
        .manage(PtyState::default())
        .manage(WindowStartDirectories::default())
        .manage(AppCloseState::default())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            save_liquid_cursor,
            open_config,
            show_notification,
            start_terminal,
            write_terminal,
            resize_terminal,
            stop_terminal,
            toggle_devtools,
            new_window,
            request_close_app,
            confirm_app_close,
            get_git_context
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                window.state::<PtyState>().stop(window.label());
                window
                    .state::<WindowStartDirectories>()
                    .remove(window.label());
                let should_exit = window
                    .state::<AppCloseState>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut pending| {
                        let windows = pending.as_mut()?;
                        windows.remove(window.label());
                        if windows.is_empty() {
                            *pending = None;
                            Some(true)
                        } else {
                            Some(false)
                        }
                    })
                    .unwrap_or(false);
                if should_exit {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running pnex");
}
