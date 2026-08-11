use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tempfile::NamedTempFile;

const CONFIG_FILE_NAME: &str = "pnex-config.json";
const DEFAULT_FONT_FAMILY: &str = "Consolas, \"Courier New\", monospace";
#[cfg(target_os = "windows")]
const WINDOWS_FALLBACK_SHELL: &str = "powershell.exe";

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorAnimation {
    Disabled,
    #[default]
    Liquid,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LiquidCursorSettings {
    pub animation_length: u16,
    pub short_animation_length: u16,
    pub instant_short_moves: bool,
    pub instant_short_move_distance: u8,
    pub instant_short_move_delay: u8,
    pub trail_size: u8,
    pub typing_overlay: bool,
    pub input_shadow: bool,
    pub input_shadow_opacity: u8,
}

impl Default for LiquidCursorSettings {
    fn default() -> Self {
        Self {
            animation_length: 125,
            short_animation_length: 10,
            instant_short_moves: false,
            instant_short_move_distance: 2,
            instant_short_move_delay: 30,
            trail_size: 95,
            typing_overlay: false,
            input_shadow: true,
            input_shadow_opacity: 45,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub shell: String,
    pub start_directory: String,
    pub font_size: u16,
    pub font_family: String,
    pub theme: Value,
    pub cursor_animation: CursorAnimation,
    pub liquid_cursor: LiquidCursorSettings,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shell: String::new(),
            start_directory: "~/".to_owned(),
            font_size: 14,
            font_family: DEFAULT_FONT_FAMILY.to_owned(),
            theme: default_theme(),
            cursor_animation: CursorAnimation::Liquid,
            liquid_cursor: LiquidCursorSettings::default(),
            extra: BTreeMap::new(),
        }
    }
}

fn default_theme() -> Value {
    serde_json::json!({
        "name": "Vesper",
        "background": "#101010",
        "foreground": "#ffffff",
        "cursor": "#aeafad",
        "cursorAccent": "#101010",
        "selection": "#323232",
        "black": "#101010",
        "red": "#f5a191",
        "green": "#90b99f",
        "yellow": "#e6b99d",
        "blue": "#aca1cf",
        "magenta": "#e29eca",
        "cyan": "#ea83a5",
        "white": "#a0a0a0",
        "brightBlack": "#7e7e7e",
        "brightRed": "#ff8080",
        "brightGreen": "#99ffe4",
        "brightYellow": "#ffc799",
        "brightBlue": "#b9aeda",
        "brightMagenta": "#ecaad6",
        "brightCyan": "#f591b2",
        "brightWhite": "#ffffff"
    })
}

#[cfg(target_os = "windows")]
fn windows_default_shell(git_bash: Option<PathBuf>) -> String {
    git_bash
        .map(|path| format!("\"{}\" --login -i", path.to_string_lossy()))
        .unwrap_or_else(|| WINDOWS_FALLBACK_SHELL.to_owned())
}

#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(directory) = std::env::var_os(variable) {
            add_git_bash_candidates(&mut candidates, &PathBuf::from(directory).join("Git"));
        }
    }
    if let Some(directory) = std::env::var_os("LOCALAPPDATA") {
        add_git_bash_candidates(
            &mut candidates,
            &PathBuf::from(directory).join("Programs").join("Git"),
        );
    }

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            let git = directory.join("git.exe");
            if !git.is_file() {
                continue;
            }
            for root in git.ancestors().skip(2).take(3) {
                add_git_bash_candidates(&mut candidates, root);
            }
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn add_git_bash_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    candidates.push(root.join("bin").join("bash.exe"));
    candidates.push(root.join("usr").join("bin").join("bash.exe"));
}

#[cfg(target_os = "windows")]
fn initialize_windows_shell(config: &mut AppConfig) -> bool {
    if !config.shell.trim().is_empty() {
        return false;
    }

    config.shell = windows_default_shell(find_git_bash());
    true
}

#[cfg(not(target_os = "windows"))]
fn initialize_windows_shell(_config: &mut AppConfig) -> bool {
    false
}

pub struct ConfigStore {
    home_directory: PathBuf,
    path: PathBuf,
    config: Mutex<AppConfig>,
}

impl ConfigStore {
    pub fn load(home_directory: PathBuf) -> Result<Self, String> {
        let path = home_directory.join(CONFIG_FILE_NAME);
        let (mut config, mut should_persist) = match fs::read_to_string(&path) {
            Ok(content) => (
                serde_json::from_str(&content).map_err(|error| {
                    format!("Invalid configuration at {}: {error}", path.display())
                })?,
                false,
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (AppConfig::default(), true)
            }
            Err(error) => {
                return Err(format!(
                    "Could not read configuration at {}: {error}",
                    path.display()
                ));
            }
        };
        should_persist |= initialize_windows_shell(&mut config);
        if should_persist {
            persist(&path, &config)?;
        }

        Ok(Self {
            home_directory,
            path,
            config: Mutex::new(config),
        })
    }

    pub fn get(&self) -> Result<AppConfig, String> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(lock_error)
    }

    pub fn save(&self, mut config: AppConfig) -> Result<(), String> {
        let mut current = self.config.lock().map_err(lock_error)?;
        // Liquid Cursor has a dedicated patch command. Preserve its latest values when
        // another window saves an older full configuration.
        config.cursor_animation = current.cursor_animation.clone();
        config.liquid_cursor = current.liquid_cursor.clone();
        validate(&config)?;
        persist(&self.path, &config)?;
        *current = config;
        Ok(())
    }

    pub fn save_liquid_cursor(
        &self,
        cursor_animation: CursorAnimation,
        liquid_cursor: LiquidCursorSettings,
    ) -> Result<(), String> {
        let mut current = self.config.lock().map_err(lock_error)?;
        let mut next = current.clone();
        next.cursor_animation = cursor_animation;
        next.liquid_cursor = liquid_cursor;
        validate(&next)?;
        persist(&self.path, &next)?;
        *current = next;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn home_directory(&self) -> &Path {
        &self.home_directory
    }
}

fn persist(path: &Path, config: &AppConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Configuration path has no parent: {}", path.display()))?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        format!(
            "Could not create a temporary configuration at {}: {error}",
            parent.display()
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, config)
        .map_err(|error| format!("Could not serialize configuration: {error}"))?;
    temporary.write_all(b"\n").map_err(|error| {
        format!(
            "Could not write the temporary configuration for {}: {error}",
            path.display()
        )
    })?;
    temporary.as_file().sync_all().map_err(|error| {
        format!(
            "Could not flush the temporary configuration for {}: {error}",
            path.display()
        )
    })?;
    temporary.persist(path).map_err(|error| {
        format!(
            "Could not replace configuration at {}: {}",
            path.display(),
            error.error
        )
    })?;
    Ok(())
}

fn validate(config: &AppConfig) -> Result<(), String> {
    if config.font_family.trim().is_empty() {
        return Err("fontFamily must not be empty.".to_owned());
    }

    if !(6..=72).contains(&config.font_size) {
        return Err("fontSize must be between 6 and 72.".to_owned());
    }

    if config.liquid_cursor.animation_length > 500 {
        return Err("liquidCursor.animationLength must be between 0 and 500.".to_owned());
    }

    if config.liquid_cursor.short_animation_length > 200 {
        return Err("liquidCursor.shortAnimationLength must be between 0 and 200.".to_owned());
    }

    if !(1..=5).contains(&config.liquid_cursor.instant_short_move_distance) {
        return Err("liquidCursor.instantShortMoveDistance must be between 1 and 5.".to_owned());
    }

    if config.liquid_cursor.instant_short_move_delay > 100 {
        return Err("liquidCursor.instantShortMoveDelay must be between 0 and 100.".to_owned());
    }

    if config.liquid_cursor.trail_size > 100 {
        return Err("liquidCursor.trailSize must be between 0 and 100.".to_owned());
    }

    if !(10..=100).contains(&config.liquid_cursor.input_shadow_opacity) {
        return Err("liquidCursor.inputShadowOpacity must be between 10 and 100.".to_owned());
    }

    Ok(())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "The configuration lock is unavailable.".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigStore, CursorAnimation, LiquidCursorSettings};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_directory() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("pnex-config-test-{nonce}"))
    }

    #[test]
    fn creates_the_default_config_on_first_load() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");

        let store = ConfigStore::load(directory.clone()).expect("config store");
        let config = store.get().expect("config");

        assert_eq!(config.start_directory, "~/");
        assert_eq!(config.font_size, 14);
        assert_eq!(config.theme["name"], "Vesper");
        assert_eq!(config.cursor_animation, CursorAnimation::Liquid);
        assert_eq!(config.liquid_cursor.animation_length, 125);
        assert_eq!(config.liquid_cursor.short_animation_length, 10);
        assert!(!config.liquid_cursor.instant_short_moves);
        assert_eq!(config.liquid_cursor.instant_short_move_distance, 2);
        assert_eq!(config.liquid_cursor.instant_short_move_delay, 30);
        assert_eq!(config.liquid_cursor.trail_size, 95);
        assert!(!config.liquid_cursor.typing_overlay);
        assert!(config.liquid_cursor.input_shadow);
        assert_eq!(config.liquid_cursor.input_shadow_opacity, 45);
        assert!(store.path().is_file());

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn formats_git_bash_as_an_interactive_login_shell() {
        let shell = super::windows_default_shell(Some(std::path::PathBuf::from(
            r"C:\Program Files\Git\bin\bash.exe",
        )));

        assert_eq!(shell, r#""C:\Program Files\Git\bin\bash.exe" --login -i"#);
        assert_eq!(super::windows_default_shell(None), "powershell.exe");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn fills_and_persists_an_empty_shell() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("pnex-config.json");
        fs::write(&path, r#"{"shell":"","theme":{"name":"Dracula"}}"#).expect("legacy config");

        let store = ConfigStore::load(directory.clone()).expect("config store");
        let config = store.get().expect("config");
        let saved: AppConfig =
            serde_json::from_str(&fs::read_to_string(path).expect("saved config"))
                .expect("saved config json");

        assert!(!config.shell.is_empty());
        assert_eq!(saved.shell, config.shell);
        assert_eq!(config.theme["name"], "Dracula");

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn preserves_an_explicit_shell() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("pnex-config.json");
        fs::write(&path, r#"{"shell":"custom-shell"}"#).expect("config");

        let store = ConfigStore::load(directory.clone()).expect("config store");

        assert_eq!(store.get().expect("config").shell, "custom-shell");

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn preserves_theme_from_legacy_config() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("pnex-config.json");
        fs::write(
            &path,
            r##"{"theme":{"name":"Dracula","background":"#282a36"}}"##,
        )
        .expect("legacy config");

        let store = ConfigStore::load(directory.clone()).expect("config store");
        let config = store.get().expect("config");

        assert_eq!(config.theme["name"], "Dracula");
        assert_eq!(config.theme["background"], "#282a36");
        assert_eq!(config.cursor_animation, CursorAnimation::Liquid);
        assert_eq!(config.liquid_cursor, Default::default());

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn a_stale_full_save_does_not_overwrite_liquid_cursor_settings() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let store = ConfigStore::load(directory.clone()).expect("config store");
        let mut stale_config = store.get().expect("stale config");

        store
            .save_liquid_cursor(
                CursorAnimation::Disabled,
                LiquidCursorSettings {
                    animation_length: 250,
                    short_animation_length: 80,
                    instant_short_moves: false,
                    instant_short_move_distance: 4,
                    instant_short_move_delay: 25,
                    trail_size: 60,
                    typing_overlay: false,
                    input_shadow: false,
                    input_shadow_opacity: 70,
                },
            )
            .expect("save liquid cursor");
        stale_config.font_size = 18;
        store.save(stale_config).expect("save stale config");

        let saved = store.get().expect("saved config");
        assert_eq!(saved.font_size, 18);
        assert_eq!(saved.cursor_animation, CursorAnimation::Disabled);
        assert_eq!(saved.liquid_cursor.animation_length, 250);
        assert_eq!(saved.liquid_cursor.short_animation_length, 80);
        assert!(!saved.liquid_cursor.instant_short_moves);
        assert_eq!(saved.liquid_cursor.instant_short_move_distance, 4);
        assert_eq!(saved.liquid_cursor.instant_short_move_delay, 25);
        assert_eq!(saved.liquid_cursor.trail_size, 60);
        assert!(!saved.liquid_cursor.typing_overlay);
        assert!(!saved.liquid_cursor.input_shadow);
        assert_eq!(saved.liquid_cursor.input_shadow_opacity, 70);

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn preserves_unknown_legacy_fields_when_saving() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("pnex-config.json");
        fs::write(&path, r#"{"fontSize":16,"legacySetting":true}"#).expect("legacy config");

        let store = ConfigStore::load(directory.clone()).expect("config store");
        let mut config: AppConfig = store.get().expect("config");
        config.font_size = 18;
        store.save(config).expect("save config");

        let saved = fs::read_to_string(path).expect("saved config");
        assert!(saved.contains("legacySetting"));
        assert!(saved.contains("18"));

        fs::remove_dir_all(directory).expect("remove test directory");
    }
}
