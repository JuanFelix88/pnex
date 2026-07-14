use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    ipc::{Channel, Response},
    Emitter, WebviewWindow,
};

const TERMINAL_EXIT_EVENT: &str = "terminal:exit";
const TERMINAL_ERROR_EVENT: &str = "terminal:error";

#[derive(Debug, Deserialize)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStarted {
    pub session_id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalError {
    session_id: u64,
    message: String,
}

struct ActiveTerminal {
    id: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct PtyState {
    active: Arc<Mutex<HashMap<String, ActiveTerminal>>>,
    next_session_id: Arc<AtomicU64>,
}

impl PtyState {
    pub fn start(
        &self,
        window: WebviewWindow,
        output: Channel<Response>,
        size: TerminalSize,
        shell: &str,
        start_directory: &str,
        home_directory: &Path,
    ) -> Result<TerminalStarted, String> {
        let window_label = window.label().to_owned();
        let size = sanitize_size(size)?;
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(size).map_err(display_error)?;
        let reader = pair.master.try_clone_reader().map_err(display_error)?;
        let mut command = shell_command(shell);
        command.env("TERM", "xterm-256color");
        command.env("PNEX", "1");
        command.cwd(resolve_start_directory(start_directory, home_directory));
        let mut child = pair.slave.spawn_command(command).map_err(display_error)?;
        let mut writer = pair.master.take_writer().map_err(display_error)?;
        writer
            .write_all(prompt_initializer(shell).as_bytes())
            .and_then(|_| writer.flush())
            .map_err(display_error)?;
        let session_id = self.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;

        {
            let mut active = self.active.lock().map_err(lock_error)?;
            if active.contains_key(&window_label) {
                let _ = child.kill();
                return Err("A terminal session is already running in this window.".to_owned());
            }

            active.insert(
                window_label.clone(),
                ActiveTerminal {
                    id: session_id,
                    master: pair.master,
                    writer,
                    child,
                },
            );
        }

        self.spawn_reader(window, output, session_id, reader);
        Ok(TerminalStarted { session_id })
    }

    pub fn write(&self, window_label: &str, data: &[u8]) -> Result<(), String> {
        let mut active = self.active.lock().map_err(lock_error)?;
        let terminal = active
            .get_mut(window_label)
            .ok_or_else(|| "No terminal session is running.".to_owned())?;

        terminal.writer.write_all(data).map_err(display_error)
    }

    pub fn resize(&self, window_label: &str, size: TerminalSize) -> Result<(), String> {
        let size = sanitize_size(size)?;
        let active = self.active.lock().map_err(lock_error)?;
        let terminal = active
            .get(window_label)
            .ok_or_else(|| "No terminal session is running.".to_owned())?;

        terminal.master.resize(size).map_err(display_error)
    }

    pub fn stop(&self, window_label: &str) {
        let terminal = self
            .active
            .lock()
            .ok()
            .and_then(|mut active| active.remove(window_label));
        if let Some(mut terminal) = terminal {
            let _ = terminal.child.kill();
        }
    }

    fn spawn_reader(
        &self,
        window: WebviewWindow,
        output: Channel<Response>,
        session_id: u64,
        mut reader: Box<dyn Read + Send>,
    ) {
        let state = self.clone();
        let window_label = window.label().to_owned();

        std::thread::spawn(move || {
            let mut buffer = [0_u8; 65_536];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(length) => {
                        if !state.is_current(&window_label, session_id) {
                            return;
                        }

                        let data = buffer[..length].to_vec();
                        let _ = output.send(Response::new(data));
                    }
                    Err(error) => {
                        if state.is_current(&window_label, session_id) {
                            let _ = window.emit(
                                TERMINAL_ERROR_EVENT,
                                TerminalError {
                                    session_id,
                                    message: error.to_string(),
                                },
                            );
                        }
                        break;
                    }
                }
            }

            if state.clear_if_current(&window_label, session_id) {
                let _ = window.emit(TERMINAL_EXIT_EVENT, TerminalExit { session_id });
            }
        });
    }

    fn is_current(&self, window_label: &str, session_id: u64) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| {
                active
                    .get(window_label)
                    .map(|terminal| terminal.id == session_id)
            })
            .unwrap_or(false)
    }

    fn clear_if_current(&self, window_label: &str, session_id: u64) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };

        if active
            .get(window_label)
            .is_some_and(|terminal| terminal.id == session_id)
        {
            active.remove(window_label);
            true
        } else {
            false
        }
    }
}

fn sanitize_size(size: TerminalSize) -> Result<PtySize, String> {
    if size.cols < 2 || size.rows < 2 {
        return Err("Terminal dimensions must be at least 2 columns by 2 rows.".to_owned());
    }

    Ok(PtySize {
        cols: size.cols,
        rows: size.rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn shell_command(shell: &str) -> CommandBuilder {
    let (program, arguments) = parse_shell(shell);
    let mut command = CommandBuilder::new(program);
    command.args(arguments);
    command
}

fn parse_shell(shell: &str) -> (String, Vec<String>) {
    let shell = shell.trim();
    if shell.is_empty() {
        return (default_shell(), Vec::new());
    }

    if let Some(rest) = shell.strip_prefix('"') {
        if let Some((program, arguments)) = rest.split_once('"') {
            return (
                program.to_owned(),
                arguments.split_whitespace().map(str::to_owned).collect(),
            );
        }
    }

    let mut parts = shell.split_whitespace();
    let program = parts.next().unwrap_or_default().to_owned();
    (program, parts.map(str::to_owned).collect())
}

fn prompt_initializer(shell: &str) -> &'static str {
    let shell = if shell.trim().is_empty() {
        default_shell()
    } else {
        shell.to_owned()
    };
    if shell.to_ascii_lowercase().contains("powershell")
        || shell.to_ascii_lowercase().contains("pwsh")
    {
        "function prompt { $code = if ($?) { 0 } else { 1 }; $cwd = (Get-Location).Path; Write-Host -NoNewline (\"$([char]27)]7777;exit=${code}$([char]7)$([char]27)]7777;cwd=${cwd}$([char]7)\"); \"`n  \" }; cls\r\r"
    } else {
        "__pnex_prompt(){ local exit_code=\"$?\" cwd=\"$(pwd)\"; printf '\\033]7777;exit=%s\\007\\033]7777;cwd=%s\\007' \"$exit_code\" \"$cwd\"; }; PROMPT_COMMAND=__pnex_prompt; PS1=\"\\n  \"; clear\r"
    }
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_owned()
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_owned())
    }
}

fn resolve_start_directory(start_directory: &str, home_directory: &Path) -> PathBuf {
    let start_directory = start_directory.trim();
    if start_directory.is_empty() || start_directory == "~" {
        return home_directory.to_owned();
    }

    let expanded = start_directory
        .strip_prefix("~/")
        .or_else(|| start_directory.strip_prefix("~\\"))
        .map(|suffix| home_directory.join(suffix))
        .unwrap_or_else(|| PathBuf::from(start_directory));

    match fs::metadata(&expanded) {
        Ok(metadata) if metadata.is_dir() => expanded,
        _ => home_directory.to_owned(),
    }
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "The terminal session lock is unavailable.".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{prompt_initializer, sanitize_size, TerminalSize};

    #[test]
    fn accepts_usable_terminal_dimensions() {
        let size = sanitize_size(TerminalSize { cols: 80, rows: 24 }).expect("valid size");

        assert_eq!(size.cols, 80);
        assert_eq!(size.rows, 24);
    }

    #[test]
    fn rejects_collapsed_terminal_dimensions() {
        assert!(sanitize_size(TerminalSize { cols: 1, rows: 24 }).is_err());
        assert!(sanitize_size(TerminalSize { cols: 80, rows: 1 }).is_err());
    }

    #[test]
    fn prompt_initializer_does_not_block_on_git_metadata() {
        let prompt = prompt_initializer("powershell.exe");

        assert!(prompt.contains("exit=${code}"));
        assert!(prompt.contains("cwd=${cwd}"));
        assert!(!prompt.contains("git "));
    }

    #[test]
    fn prompt_initializer_reserves_the_line_after_the_hud() {
        let powershell = prompt_initializer("powershell.exe");
        assert!(powershell.contains("Write-Host -NoNewline (\"$([char]27)]7777;"));
        assert!(powershell.contains("; \"`n  \" };"));

        let bash = prompt_initializer("/bin/bash");
        assert!(bash.contains("printf '\\033]7777;"));
        assert!(bash.contains("PS1=\"\\n  \""));
    }
}
