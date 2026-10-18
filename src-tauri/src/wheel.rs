//! ファイルのドラッグ中に円形メニュー（ホイール）を出す仕組み。
//! Windows では低レベルのマウス/キーボードフックでドラッグ開始を検知する。
//! ファイルのドラッグ中は Explorer などがドラッグ画像用の `SysDragImage` ウィンドウを作るので、
//! それが見えていれば「ファイルのドラッグ」と判断する（通常の範囲選択やウィンドウ移動では出さない）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "wheel";
const SIZE: f64 = 420.0;

static APP: OnceLock<AppHandle> = OnceLock::new();
static SHOWN: AtomicBool = AtomicBool::new(false);
/// 左ボタンが押されている間
static DOWN: AtomicBool = AtomicBool::new(false);
/// キャンセルされたドラッグ。ボタンを離すまで再表示しない
static SUPPRESS: AtomicBool = AtomicBool::new(false);
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
    let _ = app.emit("wheel-show", ());
    let _ = w.show();
    SHOWN.store(true, Ordering::SeqCst);
}

/// ホイールを閉じる。ドラッグ中なら、ボタンを離すまで出し直さない。
pub fn hide() {
    SHOWN.store(false, Ordering::SeqCst);
    BUSY.store(false, Ordering::SeqCst);
    if DOWN.load(Ordering::SeqCst) {
        SUPPRESS.store(true, Ordering::SeqCst);
    }
    if let Some(w) = APP.get().and_then(|a| a.get_webview_window(LABEL)) {
        let _ = w.hide();
    }
}

#[cfg(windows)]
mod hook {
    use super::*;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static START: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));

    fn file_drag_in_progress() -> bool {
        let class: Vec<u16> = "SysDragImage\0".encode_utf16().collect();
        unsafe {
            let h: HWND = FindWindowW(class.as_ptr(), std::ptr::null());
            !h.is_null() && IsWindowVisible(h) != 0
        }
    }

    unsafe extern "system" fn mouse(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            let m = unsafe { &*(l as *const MSLLHOOKSTRUCT) };
            match w as u32 {
                WM_LBUTTONDOWN => {
                    DOWN.store(true, Ordering::SeqCst);
                    SUPPRESS.store(false, Ordering::SeqCst);
                    *START.lock().unwrap() = (m.pt.x, m.pt.y);
                }
                WM_MOUSEMOVE
                    if DOWN.load(Ordering::SeqCst)
                        && !SHOWN.load(Ordering::SeqCst)
                        && !SUPPRESS.load(Ordering::SeqCst) =>
                {
                    let (sx, sy) = *START.lock().unwrap();
                    if (m.pt.x - sx).abs().max((m.pt.y - sy).abs()) > 24 && file_drag_in_progress() {
                        super::show_at(m.pt.x, m.pt.y);
                    }
                }
                WM_LBUTTONUP => {
                    DOWN.store(false, Ordering::SeqCst);
                    SUPPRESS.store(false, Ordering::SeqCst);
                    if SHOWN.load(Ordering::SeqCst) {
                        // ドロップが無ければ少し待って閉じる
                        std::thread::spawn(|| {
                            std::thread::sleep(Duration::from_millis(900));
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

    unsafe extern "system" fn keyboard(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 && SHOWN.load(Ordering::SeqCst) && (w as u32 == WM_KEYDOWN || w as u32 == WM_SYSKEYDOWN) {
            let k = unsafe { &*(l as *const KBDLLHOOKSTRUCT) };
            if k.vkCode == VK_ESCAPE as u32 {
                super::hide();
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, w, l) }
    }

    pub fn run() {
        unsafe {
            if SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), std::ptr::null_mut(), 0).is_null() {
                return;
            }
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), std::ptr::null_mut(), 0);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
