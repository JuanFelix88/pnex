use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const CONFIG_FILE_NAME: &str = "pnex-config.json";
const DEFAULT_FONT_FAMILY: &str = "Consolas, \"Courier New\", monospace";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub shell: String,
    pub start_directory: String,
    pub font_size: u16,
    pub font_family: String,
    pub theme: Value,
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

    pub fn save(&self, config: AppConfig) -> Result<(), String> {
        validate(&config)?;
        persist(&self.path, &config)?;
        let mut current = self.config.lock().map_err(lock_error)?;
        *current = config;
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
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Could not serialize configuration: {error}"))?;
    fs::write(path, format!("{content}\n")).map_err(|error| {
        format!(
            "Could not write configuration at {}: {error}",
            path.display()
        )
    })
}

fn validate(config: &AppConfig) -> Result<(), String> {
    if config.font_family.trim().is_empty() {
        return Err("fontFamily must not be empty.".to_owned());
    }

    if !(6..=72).contains(&config.font_size) {
        return Err("fontSize must be between 6 and 72.".to_owned());
    }

    Ok(())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "The configuration lock is unavailable.".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigStore};
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
        assert!(store.path().is_file());

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn preserves_theme_from_legacy_config() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("pnex-config.json");
        fs::write(&path, r##"{"theme":{"name":"Dracula","background":"#282a36"}}"##)
            .expect("legacy config");

        let store = ConfigStore::load(directory.clone()).expect("config store");
        let config = store.get().expect("config");

        assert_eq!(config.theme["name"], "Dracula");
        assert_eq!(config.theme["background"], "#282a36");

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
