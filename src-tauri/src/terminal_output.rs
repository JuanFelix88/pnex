use std::sync::Arc;
use tauri::{
    ipc::{Channel, Response},
    WebviewWindow,
};

#[derive(Clone)]
pub enum TerminalOutput {
    Channel(Channel<Response>),
    #[cfg(target_os = "windows")]
    Shared(Arc<SharedTerminalOutput>),
}

impl TerminalOutput {
    pub fn channel(channel: Channel<Response>) -> Self {
        Self::Channel(channel)
    }

    #[cfg(target_os = "windows")]
    pub fn shared(output: Arc<SharedTerminalOutput>) -> Self {
        Self::Shared(output)
    }

    pub fn mode(&self) -> &'static str {
        match self {
            Self::Channel(_) => "channel",
            #[cfg(target_os = "windows")]
            Self::Shared(_) => "shared",
        }
    }

    pub fn send(&self, data: &[u8]) -> Result<(), String> {
        match self {
            Self::Channel(channel) => channel
                .send(Response::new(data.to_vec()))
                .map_err(|error| error.to_string()),
            #[cfg(target_os = "windows")]
            Self::Shared(output) => output.write(data),
        }
    }

    pub fn close(&self) {
        #[cfg(target_os = "windows")]
        if let Self::Shared(output) = self {
            output.close();
        }
    }
}

#[derive(Default)]
pub struct PendingTerminalOutputs {
    #[cfg(target_os = "windows")]
    inner: std::sync::Mutex<std::collections::HashMap<String, PendingTerminalOutput>>,
}

#[cfg(target_os = "windows")]
struct PendingTerminalOutput {
    token: String,
    output: Arc<SharedTerminalOutput>,
}

impl PendingTerminalOutputs {
    #[cfg(target_os = "windows")]
    pub fn insert(
        &self,
        window_label: String,
        token: String,
        output: Arc<SharedTerminalOutput>,
    ) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "Terminal output state is unavailable.".to_owned())?
            .insert(window_label, PendingTerminalOutput { token, output });
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub fn take(
        &self,
        window_label: &str,
        token: Option<&str>,
    ) -> Option<Arc<SharedTerminalOutput>> {
        let token = token?;
        let mut outputs = self.inner.lock().ok()?;
        let pending = outputs.get(window_label)?;
        if pending.token != token {
            return None;
        }
        outputs.remove(window_label).map(|pending| pending.output)
    }

    #[cfg(not(target_os = "windows"))]
    pub fn take(&self, _window_label: &str, _token: Option<&str>) -> Option<()> {
        None
    }

    pub fn remove(&self, window_label: &str, token: Option<&str>) {
        #[cfg(target_os = "windows")]
        if let Ok(mut outputs) = self.inner.lock() {
            let should_remove = outputs
                .get(window_label)
                .is_some_and(|pending| token.is_none_or(|token| pending.token == token));
            if should_remove {
                outputs.remove(window_label);
            }
        }

        #[cfg(not(target_os = "windows"))]
        let _ = (window_label, token);
    }
}

pub async fn prepare_shared_terminal_output(
    window: WebviewWindow,
    token: String,
) -> Result<Option<Arc<SharedTerminalOutput>>, String> {
    if token.is_empty() || token.len() > 128 || !token.is_ascii() {
        return Err("Terminal output token is invalid.".to_owned());
    }

    #[cfg(target_os = "windows")]
    {
        SharedTerminalOutput::create(window, token).await.map(Some)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, token);
        Ok(None)
    }
}

#[cfg(not(target_os = "windows"))]
pub struct SharedTerminalOutput;

#[cfg(target_os = "windows")]
const RING_MAGIC: u32 = 0x5845_4E50;
#[cfg(target_os = "windows")]
const RING_VERSION: u32 = 1;
#[cfg(target_os = "windows")]
const HEADER_SIZE: usize = 64;
#[cfg(target_os = "windows")]
const DATA_CAPACITY: usize = 1024 * 1024;
#[cfg(target_os = "windows")]
const TOTAL_SIZE: usize = HEADER_SIZE + DATA_CAPACITY;
#[cfg(target_os = "windows")]
const WRITE_POSITION_OFFSET: usize = 16;
#[cfg(target_os = "windows")]
const READ_POSITION_OFFSET: usize = 20;

#[cfg(target_os = "windows")]
pub struct SharedTerminalOutput {
    mapping: MappedRing,
    window: WebviewWindow,
    token: String,
    notification_queued: std::sync::atomic::AtomicBool,
    failed: std::sync::atomic::AtomicBool,
    closed: std::sync::atomic::AtomicBool,
}

#[cfg(target_os = "windows")]
impl SharedTerminalOutput {
    async fn create(window: WebviewWindow, token: String) -> Result<Arc<Self>, String> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let output_window = window.clone();
        window
            .with_webview(move |webview| {
                let result = unsafe { Self::create_on_main_thread(webview, output_window, token) };
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;

        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|_| "Timed out while preparing shared terminal output.".to_owned())?
        })
        .await
        .map_err(|error| error.to_string())?
    }

    unsafe fn create_on_main_thread(
        webview: tauri::webview::PlatformWebview,
        window: WebviewWindow,
        token: String,
    ) -> Result<Arc<Self>, String> {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment12, ICoreWebView2_17,
            COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
        };
        use windows::core::Interface;

        let environment = webview
            .environment()
            .cast::<ICoreWebView2Environment12>()
            .map_err(|error| error.to_string())?;
        let core_webview = webview
            .controller()
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        let core_webview = core_webview
            .cast::<ICoreWebView2_17>()
            .map_err(|error| error.to_string())?;
        let shared_buffer = environment
            .CreateSharedBuffer(TOTAL_SIZE as u64)
            .map_err(|error| error.to_string())?;

        let result = (|| {
            let mapping = MappedRing::from_shared_buffer(&shared_buffer)?;
            mapping.initialize();
            let metadata = serde_json::json!({
                "kind": "pnex-terminal-output",
                "token": token,
            })
            .to_string();
            let metadata = wide_string(&metadata);
            core_webview
                .PostSharedBufferToScript(
                    &shared_buffer,
                    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
                    windows::core::PCWSTR(metadata.as_ptr()),
                )
                .map_err(|error| error.to_string())?;

            Ok(Arc::new(Self {
                mapping,
                window,
                token,
                notification_queued: std::sync::atomic::AtomicBool::new(false),
                failed: std::sync::atomic::AtomicBool::new(false),
                closed: std::sync::atomic::AtomicBool::new(false),
            }))
        })();

        let _ = shared_buffer.Close();
        result
    }

    fn close(&self) {
        self.closed
            .store(true, std::sync::atomic::Ordering::Release);
    }

    fn write(self: &Arc<Self>, mut data: &[u8]) -> Result<(), String> {
        use std::sync::atomic::Ordering;

        while !data.is_empty() {
            if self.closed.load(Ordering::Acquire) {
                return Err("Shared terminal output transport is closed.".to_owned());
            }
            if self.failed.load(Ordering::Acquire) {
                return Err("Shared terminal output transport failed.".to_owned());
            }

            let write_position = self.mapping.write_position().load(Ordering::Relaxed);
            let read_position = self.mapping.read_position().load(Ordering::Acquire);
            let used = used_capacity(write_position, read_position);
            if used > DATA_CAPACITY as u32 {
                self.failed.store(true, Ordering::Release);
                return Err("Shared terminal output positions are invalid.".to_owned());
            }

            let available = DATA_CAPACITY - used as usize;
            if available == 0 {
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }

            let offset = write_position as usize & (DATA_CAPACITY - 1);
            let length = data.len().min(available).min(DATA_CAPACITY - offset);
            unsafe {
                std::ptr::copy_nonoverlapping(
                    data.as_ptr(),
                    self.mapping.data_pointer().add(offset),
                    length,
                );
            }
            self.mapping.write_position().store(
                write_position.wrapping_add(length as u32),
                Ordering::Release,
            );
            data = &data[length..];
            self.notify_script()?;
        }
        Ok(())
    }

    fn notify_script(self: &Arc<Self>) -> Result<(), String> {
        use std::sync::atomic::Ordering;

        if self
            .notification_queued
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }

        let output = Arc::clone(self);
        let message = serde_json::json!({
            "kind": "pnex-terminal-output-ready",
            "token": self.token,
        })
        .to_string();
        if let Err(error) = self.window.with_webview(move |webview| {
            let message = wide_string(&message);
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|webview| {
                    webview.PostWebMessageAsJson(windows::core::PCWSTR(message.as_ptr()))
                })
            };
            if result.is_err() {
                output.failed.store(true, Ordering::Release);
            }
            output.notification_queued.store(false, Ordering::Release);
        }) {
            self.notification_queued.store(false, Ordering::Release);
            self.failed.store(true, Ordering::Release);
            return Err(error.to_string());
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
struct MappedRing {
    view: windows::Win32::System::Memory::MEMORY_MAPPED_VIEW_ADDRESS,
    handle: windows::Win32::Foundation::HANDLE,
}

#[cfg(target_os = "windows")]
unsafe impl Send for MappedRing {}
#[cfg(target_os = "windows")]
unsafe impl Sync for MappedRing {}

#[cfg(target_os = "windows")]
impl MappedRing {
    unsafe fn from_shared_buffer(
        shared_buffer: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2SharedBuffer,
    ) -> Result<Self, String> {
        use windows::Win32::{
            Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE},
            System::{
                Memory::{MapViewOfFile, FILE_MAP_ALL_ACCESS},
                Threading::GetCurrentProcess,
            },
        };

        let mut source_handle = HANDLE::default();
        shared_buffer
            .FileMappingHandle(&mut source_handle)
            .map_err(|error| error.to_string())?;
        let process = GetCurrentProcess();
        let mut handle = HANDLE::default();
        DuplicateHandle(
            process,
            source_handle,
            process,
            &mut handle,
            0,
            false,
            DUPLICATE_SAME_ACCESS,
        )
        .map_err(|error| error.to_string())?;
        let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, TOTAL_SIZE);
        if view.Value.is_null() {
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            return Err(windows::core::Error::from_win32().to_string());
        }
        Ok(Self { view, handle })
    }

    fn initialize(&self) {
        unsafe {
            std::ptr::write_bytes(self.pointer(), 0, TOTAL_SIZE);
            (self.pointer() as *mut u32).write(RING_MAGIC);
            (self.pointer().add(4) as *mut u32).write(RING_VERSION);
            (self.pointer().add(8) as *mut u32).write(DATA_CAPACITY as u32);
        }
    }

    fn write_position(&self) -> &std::sync::atomic::AtomicU32 {
        unsafe {
            &*(self.pointer().add(WRITE_POSITION_OFFSET) as *const std::sync::atomic::AtomicU32)
        }
    }

    fn read_position(&self) -> &std::sync::atomic::AtomicU32 {
        unsafe {
            &*(self.pointer().add(READ_POSITION_OFFSET) as *const std::sync::atomic::AtomicU32)
        }
    }

    fn data_pointer(&self) -> *mut u8 {
        unsafe { self.pointer().add(HEADER_SIZE) }
    }

    fn pointer(&self) -> *mut u8 {
        self.view.Value.cast()
    }
}

#[cfg(target_os = "windows")]
impl Drop for MappedRing {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Memory::UnmapViewOfFile(self.view);
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(target_os = "windows")]
fn wide_string(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn used_capacity(write_position: u32, read_position: u32) -> u32 {
    write_position.wrapping_sub(read_position)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{used_capacity, DATA_CAPACITY};

    #[test]
    fn calculates_used_capacity_across_counter_wrap() {
        assert_eq!(used_capacity(12, 4), 8);
        assert_eq!(used_capacity(4, u32::MAX - 3), 8);
    }

    #[test]
    fn rejects_positions_beyond_ring_capacity() {
        assert!(used_capacity(DATA_CAPACITY as u32 + 1, 0) > DATA_CAPACITY as u32);
    }
}
