//! ドラッグ中に円形メニュー（ホイール）を出す仕組み。
//! Windows ではマウスの低レベルフックで「Alt を押しながらドラッグ」を検知する。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "wheel";
const SIZE: f64 = 380.0;

static APP: OnceLock<AppHandle> = OnceLock::new();
static SHOWN: AtomicBool = AtomicBool::new(false);
/// 変換中はホイールを閉じない
pub static BUSY: AtomicBool = AtomicBool::new(false);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#wheel".into()))
        .title("mikan wheel")
        .inner_size(SIZE, SIZE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .build()?;
    let _ = APP.set(app.clone());
    #[cfg(windows)]
    std::thread::spawn(hook::run);
    Ok(())
}

pub fn show_at(x: i32, y: i32) {
    let Some(app) = APP.get() else { return };
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let _ = w.set_size(LogicalSize::new(SIZE, SIZE));
    if let Ok(size) = w.outer_size() {
        let _ = w.set_position(PhysicalPosition::new(x - size.width as i32 / 2, y - size.height as i32 / 2));
    }
    let _ = w.show();
    SHOWN.store(true, Ordering::SeqCst);
}

pub fn hide() {
    SHOWN.store(false, Ordering::SeqCst);
    BUSY.store(false, Ordering::SeqCst);
    if let Some(w) = APP.get().and_then(|a| a.get_webview_window(LABEL)) {
        let _ = w.hide();
    }
}

#[cfg(windows)]
mod hook {
    use super::*;
    use std::time::Duration;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static DOWN: AtomicBool = AtomicBool::new(false);
    static START: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));

    unsafe extern "system" fn proc(code: i32, w: usize, l: isize) -> isize {
        if code >= 0 {
            let m = unsafe { &*(l as *const MSLLHOOKSTRUCT) };
            match w as u32 {
                WM_LBUTTONDOWN => {
                    DOWN.store(true, Ordering::SeqCst);
                    *START.lock().unwrap() = (m.pt.x, m.pt.y);
                }
                WM_MOUSEMOVE if DOWN.load(Ordering::SeqCst) && !SHOWN.load(Ordering::SeqCst) => {
                    let (sx, sy) = *START.lock().unwrap();
                    let moved = (m.pt.x - sx).abs().max((m.pt.y - sy).abs()) > 12;
                    let alt = unsafe { GetAsyncKeyState(VK_MENU as i32) } as u16 & 0x8000 != 0;
                    if moved && alt {
                        super::show_at(m.pt.x, m.pt.y);
                    }
                }
                WM_LBUTTONUP => {
                    DOWN.store(false, Ordering::SeqCst);
                    if SHOWN.load(Ordering::SeqCst) {
                        // ドロップが無ければ少し待って閉じる
                        std::thread::spawn(|| {
                            std::thread::sleep(Duration::from_millis(1200));
                            if !BUSY.load(Ordering::SeqCst) {
                                super::hide();
                            }
                        });
                    }
                }
                _ => {}
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, w, l) }
    }

    pub fn run() {
        unsafe {
            let h = SetWindowsHookExW(WH_MOUSE_LL, Some(proc), std::ptr::null_mut(), 0);
            if h.is_null() {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
