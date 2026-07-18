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
    pub trail_size: u8,
    pub typing_overlay: bool,
    pub input_shadow: bool,
    pub input_shadow_opacity: u8,
}

impl Default for LiquidCursorSettings {
    fn default() -> Self {
        Self {
            animation_length: 150,
            short_animation_length: 40,
            trail_size: 100,
            typing_overlay: true,
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
        "name": "pnex-dark",
        "background": "#1e1e1e",
        "foreground": "#cccccc",
        "cursor": "#aeafad",
        "cursorAccent": "#1e1e1e",
        "selection": "#264f78",
        "black": "#000000",
        "red": "#cd3131",
        "green": "#0dbc79",
        "yellow": "#e5e510",
        "blue": "#2472c8",
        "magenta": "#bc3fbc",
        "cyan": "#11a8cd",
        "white": "#e5e5e5",
        "brightBlack": "#666666",
        "brightRed": "#f14c4c",
        "brightGreen": "#23d18b",
        "brightYellow": "#f5f543",
        "brightBlue": "#3b8eea",
        "brightMagenta": "#d670d6",
        "brightCyan": "#29b8db",
        "brightWhite": "#ffffff"
    })
}

pub struct ConfigStore {
    home_directory: PathBuf,
    path: PathBuf,
    config: Mutex<AppConfig>,
}

impl ConfigStore {
    pub fn load(home_directory: PathBuf) -> Result<Self, String> {
        let path = home_directory.join(CONFIG_FILE_NAME);
        let config = match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content)
                .map_err(|error| format!("Invalid configuration at {}: {error}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let config = AppConfig::default();
                persist(&path, &config)?;
                config
            }
            Err(error) => {
                return Err(format!(
                    "Could not read configuration at {}: {error}",
                    path.display()
                ));
            }
        };

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
        assert_eq!(config.theme["name"], "pnex-dark");
        assert_eq!(config.cursor_animation, CursorAnimation::Liquid);
        assert_eq!(config.liquid_cursor.animation_length, 150);
        assert_eq!(config.liquid_cursor.short_animation_length, 40);
        assert_eq!(config.liquid_cursor.trail_size, 100);
        assert!(config.liquid_cursor.typing_overlay);
        assert!(config.liquid_cursor.input_shadow);
        assert_eq!(config.liquid_cursor.input_shadow_opacity, 45);
        assert!(store.path().is_file());

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
