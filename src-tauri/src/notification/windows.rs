use std::{
    env, fs,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    thread,
};
use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Storage::EnhancedStorage::PKEY_AppUserModel_ID,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
            StructuredStorage::PROPVARIANT, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            IShellLinkW, PropertiesSystem::IPropertyStore, SetCurrentProcessExplicitAppUserModelID,
            ShellLink,
        },
    },
};

pub fn register(app_name: &str, app_identifier: &str) -> Result<(), String> {
    let app_name = app_name.to_owned();
    let app_identifier = app_identifier.to_owned();
    thread::spawn(move || register_on_com_thread(&app_name, &app_identifier))
        .join()
        .map_err(|_| "Windows notification identity registration panicked.".to_owned())?
}

fn register_on_com_thread(app_name: &str, app_identifier: &str) -> Result<(), String> {
    let executable = env::current_exe().map_err(display_error)?;
    let shortcut = shortcut_path(app_name)?;
    if let Some(parent) = shortcut.parent() {
        fs::create_dir_all(parent).map_err(display_error)?;
    }

    // SAFETY: this dedicated thread owns the COM apartment and all COM objects created below.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(display_error)?;
        let _com = ComApartment;
        create_shortcut(&executable, &shortcut, app_name, app_identifier).map_err(display_error)?;
    }

    Ok(())
}

unsafe fn create_shortcut(
    executable: &Path,
    shortcut: &Path,
    app_name: &str,
    app_identifier: &str,
) -> windows::core::Result<()> {
    let executable_wide = wide(executable.as_os_str());
    let working_directory_wide = wide(
        executable
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .as_os_str(),
    );
    let shortcut_wide = wide(shortcut.as_os_str());
    let description_wide = wide(std::ffi::OsStr::new(app_name));
    let app_identifier_wide = wide(std::ffi::OsStr::new(app_identifier));

    // SAFETY: all PCWSTR values point to null-terminated buffers that live through each call.
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(PCWSTR(app_identifier_wide.as_ptr()))?;

        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        shell_link.SetPath(PCWSTR(executable_wide.as_ptr()))?;
        shell_link.SetWorkingDirectory(PCWSTR(working_directory_wide.as_ptr()))?;
        shell_link.SetIconLocation(PCWSTR(executable_wide.as_ptr()), 0)?;
        shell_link.SetDescription(PCWSTR(description_wide.as_ptr()))?;

        let property_store: IPropertyStore = shell_link.cast()?;
        let app_id = PROPVARIANT::from(app_identifier);
        property_store.SetValue(&PKEY_AppUserModel_ID, &app_id)?;
        property_store.Commit()?;

        let persist_file: IPersistFile = shell_link.cast()?;
        persist_file.Save(PCWSTR(shortcut_wide.as_ptr()), true)?;
    }

    Ok(())
}

fn shortcut_path(app_name: &str) -> Result<PathBuf, String> {
    let app_data = env::var_os("APPDATA").ok_or_else(|| {
        "APPDATA is unavailable; cannot register Windows notifications.".to_owned()
    })?;
    Ok(PathBuf::from(app_data)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join(format!("{app_name}.lnk")))
}

fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: the guard is dropped on the thread where COM was initialized.
        unsafe { CoUninitialize() };
    }
}
