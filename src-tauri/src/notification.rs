#[cfg(target_os = "windows")]
mod windows;

use serde::Deserialize;
use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    title: String,
    body: String,
    visual_path: Option<PathBuf>,
    #[serde(default)]
    activate_window_on_click: bool,
}

impl Notification {
    pub fn new(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
            visual_path: None,
            activate_window_on_click: false,
        }
    }

    pub fn visual(mut self, path: impl Into<PathBuf>) -> Self {
        self.visual_path = Some(path.into());
        self
    }

    pub fn activate_window_on_click(mut self) -> Self {
        self.activate_window_on_click = true;
        self
    }

    pub fn should_activate_window_on_click(&self) -> bool {
        self.activate_window_on_click
    }

    fn validate(&self) -> Result<Option<&Path>, NotificationError> {
        if self.title.trim().is_empty() {
            return Err(NotificationError::EmptyTitle);
        }

        let Some(path) = self.visual_path.as_deref() else {
            return Ok(None);
        };

        if !path.is_absolute() {
            return Err(NotificationError::VisualPathNotAbsolute(path.to_owned()));
        }

        let metadata =
            fs::metadata(path).map_err(|source| NotificationError::VisualUnavailable {
                path: path.to_owned(),
                source,
            })?;
        if !metadata.is_file() {
            return Err(NotificationError::VisualNotFile(path.to_owned()));
        }
        if path.to_str().is_none() {
            return Err(NotificationError::VisualPathNotUtf8(path.to_owned()));
        }

        Ok(Some(path))
    }
}

#[derive(Clone, Debug)]
pub struct NotificationSystem {
    app_name: String,
    #[cfg(target_os = "windows")]
    app_identifier: String,
    #[cfg(target_os = "windows")]
    identity_registered: bool,
    #[cfg(target_os = "macos")]
    initialization_error: Option<String>,
}

impl NotificationSystem {
    pub fn new(
        app_name: impl Into<String>,
        app_identifier: impl Into<String>,
        is_dev: bool,
    ) -> Self {
        let app_name = app_name.into();
        let app_identifier = app_identifier.into();

        #[cfg(target_os = "windows")]
        let identity_registered = windows::register(&app_name, &app_identifier).is_ok();
        #[cfg(target_os = "windows")]
        let _ = is_dev;

        #[cfg(target_os = "macos")]
        let initialization_error = notify_rust::set_application(if is_dev {
            "com.apple.Terminal"
        } else {
            &app_identifier
        })
        .err()
        .map(|error| error.to_string());

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let _ = (app_identifier, is_dev);

        Self {
            app_name,
            #[cfg(target_os = "windows")]
            app_identifier,
            #[cfg(target_os = "windows")]
            identity_registered,
            #[cfg(target_os = "macos")]
            initialization_error,
        }
    }

    pub fn notify(&self, notification: Notification) -> Result<(), NotificationError> {
        self.show(notification, None)
    }

    pub fn notify_with_click_handler<F>(
        &self,
        notification: Notification,
        on_click: F,
    ) -> Result<(), NotificationError>
    where
        F: FnOnce() + Send + 'static,
    {
        self.show(notification, Some(Box::new(on_click)))
    }

    fn show(
        &self,
        notification: Notification,
        on_click: Option<Box<dyn FnOnce() + Send>>,
    ) -> Result<(), NotificationError> {
        let visual = notification.validate()?;

        #[cfg(target_os = "macos")]
        if let Some(error) = &self.initialization_error {
            return Err(NotificationError::Backend(error.clone()));
        }

        let mut native = notify_rust::Notification::new();
        native
            .appname(&self.app_name)
            .summary(&notification.title)
            .body(&notification.body);

        match visual {
            Some(path) => configure_visual(&mut native, path)?,
            None => {
                native.auto_icon();
            }
        }

        #[cfg(target_os = "windows")]
        if self.identity_registered {
            native.app_id(&self.app_identifier);
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        if on_click.is_some() {
            native.action("default", "Open pnex");
        }

        let handle = native
            .show()
            .map_err(|error| NotificationError::Backend(error.to_string()))?;

        if let Some(on_click) = on_click {
            // macOS builds must use notify-rust's `preview-macos-un` feature before shipping
            // click activation: the legacy NSUserNotificationCenter backend needs the main run
            // loop, while this listener intentionally waits on a background thread.
            std::thread::spawn(move || {
                let _ = handle.wait_for_response(
                    move |response: &notify_rust::NotificationResponse| {
                        if response.is_default_action() {
                            on_click();
                        }
                    },
                );
            });
        }

        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn configure_visual(
    notification: &mut notify_rust::Notification,
    path: &Path,
) -> Result<(), NotificationError> {
    notification.icon(path_string(path)?);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn configure_visual(
    notification: &mut notify_rust::Notification,
    path: &Path,
) -> Result<(), NotificationError> {
    notification.image_path(path_string(path)?);
    Ok(())
}

fn path_string(path: &Path) -> Result<&str, NotificationError> {
    path.to_str()
        .ok_or_else(|| NotificationError::VisualPathNotUtf8(path.to_owned()))
}

#[derive(Debug)]
pub enum NotificationError {
    EmptyTitle,
    VisualPathNotAbsolute(PathBuf),
    VisualUnavailable {
        path: PathBuf,
        source: std::io::Error,
    },
    VisualNotFile(PathBuf),
    VisualPathNotUtf8(PathBuf),
    Backend(String),
}

impl fmt::Display for NotificationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => formatter.write_str("Notification title cannot be empty."),
            Self::VisualPathNotAbsolute(path) => write!(
                formatter,
                "Notification visual path must be absolute: {}",
                path.display()
            ),
            Self::VisualUnavailable { path, source } => write!(
                formatter,
                "Notification visual is unavailable at {}: {source}",
                path.display()
            ),
            Self::VisualNotFile(path) => write!(
                formatter,
                "Notification visual must be a file: {}",
                path.display()
            ),
            Self::VisualPathNotUtf8(path) => write!(
                formatter,
                "Notification visual path is not valid UTF-8: {}",
                path.display()
            ),
            Self::Backend(message) => write!(formatter, "Native notification failed: {message}"),
        }
    }
}

impl Error for NotificationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::VisualUnavailable { source, .. } => Some(source),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Notification, NotificationError, NotificationSystem};
    use std::path::{Path, PathBuf};

    #[test]
    fn rejects_empty_titles() {
        assert!(matches!(
            Notification::new("  ", "body").validate(),
            Err(NotificationError::EmptyTitle)
        ));
    }

    #[test]
    fn rejects_relative_visual_paths() {
        assert!(matches!(
            Notification::new("title", "body")
                .visual("icon.png")
                .validate(),
            Err(NotificationError::VisualPathNotAbsolute(_))
        ));
    }

    #[test]
    fn rejects_directories_as_visuals() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(matches!(
            Notification::new("title", "body")
                .visual(directory)
                .validate(),
            Err(NotificationError::VisualNotFile(_))
        ));
    }

    #[test]
    fn enables_window_activation_on_click() {
        assert!(Notification::new("title", "body")
            .activate_window_on_click()
            .should_activate_window_on_click());
    }

    #[test]
    fn accepts_an_existing_absolute_visual_path() {
        let visual = test_visual();
        assert_eq!(
            Notification::new("title", "body")
                .visual(&visual)
                .validate()
                .expect("valid visual"),
            Some(visual.as_path())
        );
    }

    #[test]
    #[ignore = "displays a real native notification"]
    fn shows_native_notification() {
        let system = NotificationSystem::new("pnex", "com.pnex.desktop", true);
        system
            .notify(Notification::new("pnex", "Native notification smoke test"))
            .expect("native notification");
    }

    fn test_visual() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("icons")
            .join("icon.png")
    }
}
