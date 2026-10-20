//! ファイルのドラッグ中に円形メニュー（ホイール）を出す仕組み。
//! Windows では低レベルのマウス/キーボードフックでドラッグ開始を検知する。
//! Alt を押しながらファイルをドラッグしたときだけ出す。ファイルのドラッグ中は Explorer などがドラッグ画像用の `SysDragImage` ウィンドウを作るので、
//! それが見えていれば「ファイルのドラッグ」と判断する（通常の範囲選択やウィンドウ移動では出さない）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "wheel";
const SIZE: f64 = 420.0;

static CENTER_XY: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
static APP: OnceLock<AppHandle> = OnceLock::new();
static SHOWN: AtomicBool = AtomicBool::new(false);
/// 左ボタンが押されている間
static DOWN: AtomicBool = AtomicBool::new(false);
/// キャンセルされたドラッグ。ボタンを離すまで再表示しない
static SUPPRESS: AtomicBool = AtomicBool::new(false);
/// 変換中はホイールを閉じない
pub static BUSY: AtomicBool = AtomicBool::new(false);

/// 起動アニメーション（約2秒、クリックを邪魔しない）
fn splash(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html#splash".into()))
        .title("Dracon")
        .inner_size(320.0, 320.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .focused(false)
        .build()?;
    let _ = w.set_ignore_cursor_events(true);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2300));
        let _ = w.close();
    });
    Ok(())
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#wheel".into()))
        .title("Dracon wheel")
        .inner_size(SIZE, SIZE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // 非表示で作ると WebView2 の子ウィンドウにドロップ先が登録されず ✕ になるため、
        // 画面外に表示した状態で作り、読み込み後に隠す
        .position(-20000.0, -20000.0)
        .visible(true)
        .focused(false)
        .build()?;
    let _ = APP.set(app.clone());
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        if !SHOWN.load(Ordering::SeqCst) {
            if let Some(w) = APP.get().and_then(|a| a.get_webview_window(LABEL)) {
                let _ = w.hide();
            }
        }
    });
    #[cfg(windows)]
    std::thread::spawn(hook::run);
    if crate::settings::get().splash {
        splash(app)?;
    }
    Ok(())
}

pub fn show_at(x: i32, y: i32) {
    log(&format!("show_at {x},{y}"));
    *CENTER_XY.lock().unwrap() = (x, y);
    let Some(app) = APP.get() else { return };
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let _ = w.set_size(LogicalSize::new(SIZE, SIZE));
    if let Ok(size) = w.outer_size() {
        let _ = w.set_position(PhysicalPosition::new(x - size.width as i32 / 2, y - size.height as i32 / 2));
    }
    #[cfg(windows)]
    let _ = app.emit("wheel-show", ());
    let _ = w.show();
    SHOWN.store(true, Ordering::SeqCst);
    // ドラッグ中のOLEは次のマウス移動で初めて進入を通知するので、1pxだけ動かして促す
    #[cfg(windows)]
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;
        std::thread::sleep(std::time::Duration::from_millis(30));
        unsafe {
            // ドラッグ開始のしきい値(約4px)を超える距離だけ動かして戻す
            // 目に見えないよう、5px を 1 フレームだけ動かしてすぐ戻す
            for dx in [5, 0] {
                SetCursorPos(x + dx, y);
                std::thread::sleep(std::time::Duration::from_millis(12));
            }
        }
    });
}

/// ホイールを閉じる。ドラッグ中なら、ボタンを離すまで出し直さない。
/// 変換できないファイルだった場合: アニメーションなしで即座に隠し、ドラッグを邪魔しない
pub fn reject() {
    log("reject");
    SHOWN.store(false, Ordering::SeqCst);
    if DOWN.load(Ordering::SeqCst) {
        SUPPRESS.store(true, Ordering::SeqCst);
    }
    if let Some(w) = APP.get().and_then(|a| a.get_webview_window(LABEL)) {
        let _ = w.set_position(tauri::PhysicalPosition::new(-20000, -20000));
        let _ = w.hide();
    }
}

pub fn hide() {
    log("hide");
    SHOWN.store(false, Ordering::SeqCst);
    BUSY.store(false, Ordering::SeqCst);
    if DOWN.load(Ordering::SeqCst) {
        SUPPRESS.store(true, Ordering::SeqCst);
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("wheel-hide", ());
        // 閉じるアニメーションを見せてから隠す（その間に再表示されたら隠さない）
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(190));
            if !SHOWN.load(Ordering::SeqCst) {
                if let Some(w) = APP.get().and_then(|a| a.get_webview_window(LABEL)) {
                    let _ = w.hide();
                }
            }
        });
    }
}

#[cfg(windows)]
mod hook {
    use super::*;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static EXPLORER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    /// 押した位置がエクスプローラー/デスクトップのファイル一覧か
    fn explorer_at(x: i32, y: i32) -> bool {
        let mut h = unsafe { WindowFromPoint(windows_sys::Win32::Foundation::POINT { x, y }) };
        for _ in 0..8 {
            if h.is_null() {
                break;
            }
            let mut buf = [0u16; 64];
            let n = unsafe { GetClassNameW(h, buf.as_mut_ptr(), 64) } as usize;
            let name = String::from_utf16_lossy(&buf[..n]);
            if matches!(name.as_str(), "DirectUIHWND" | "SysListView32" | "SHELLDLL_DefView" | "CabinetWClass" | "Progman" | "WorkerW") {
                return true;
            }
            h = unsafe { GetParent(h) };
        }
        false
    }

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
                    EXPLORER.store(explorer_at(m.pt.x, m.pt.y), Ordering::SeqCst);
                }
                WM_MOUSEMOVE if SHOWN.load(Ordering::SeqCst) => {
                    // ホイール表示中は、カーソルの中心からのずれ(物理px)を伝える
                    let (cx, cy) = *CENTER_XY.lock().unwrap();
                    if let Some(app) = APP.get() {
                        let _ = app.emit("wheel-move", (m.pt.x - cx, m.pt.y - cy));
                    }
                }
                WM_MOUSEMOVE
                    if DOWN.load(Ordering::SeqCst)
                        && !SHOWN.load(Ordering::SeqCst)
                        && !SUPPRESS.load(Ordering::SeqCst) =>
                {
                    let (sx, sy) = *START.lock().unwrap();
                    let st = crate::settings::get();
                    let keys = crate::settings::trigger_keys(&st.trigger);
                    let alt = st.wheel_enabled
                        && (keys.is_empty() || keys.iter().any(|k| unsafe { GetAsyncKeyState(*k as i32) } as u16 & 0x8000 != 0));
                    // Alt を押しながらのファイルドラッグだけ反応する（普通のファイル移動は邪魔しない）
                    if alt && (m.pt.x - sx).abs().max((m.pt.y - sy).abs()) > 4 && file_drag_in_progress() {
                        super::show_at(m.pt.x, m.pt.y);
                    }
                }
                WM_LBUTTONUP => {
                    DOWN.store(false, Ordering::SeqCst);
                    SUPPRESS.store(false, Ordering::SeqCst);
                    if SHOWN.load(Ordering::SeqCst) {
                        // ドロップが無ければ少し待って閉じる
                        std::thread::spawn(|| {
                            std::thread::sleep(Duration::from_millis(180));
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
        if code >= 0 && (w as u32 == WM_KEYDOWN || w as u32 == WM_SYSKEYDOWN) {
            let k = unsafe { &*(l as *const KBDLLHOOKSTRUCT) };
            if SHOWN.load(Ordering::SeqCst) {
                if k.vkCode == VK_ESCAPE as u32 {
                    super::hide();
                }
            } else if { let st = crate::settings::get(); st.wheel_enabled && crate::settings::trigger_keys(&st.trigger).contains(&k.vkCode) }
                && DOWN.load(Ordering::SeqCst)
                && !SUPPRESS.load(Ordering::SeqCst)
                && (file_drag_in_progress() || EXPLORER.load(Ordering::SeqCst))
            {
                // ファイルを掴んだまま Alt を押したら、動かさなくてもその場で出す
                let mut pt = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut pt) } != 0 {
                    super::show_at(pt.x, pt.y);
                }
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

/// 調査用ログ（%TEMP%\\dracon-wheel.log）
pub fn log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("dracon-wheel.log")) {
        let _ = writeln!(f, "{msg}");
    }
}

/// 窓の裏をぼかし（アクリル）、窓自体を円形に切り抜く。
#[cfg(windows)]
mod blur {
    use windows_sys::Win32::Graphics::Gdi::{CreateEllipticRgn, SetWindowRgn};

    pub fn enable(w: &tauri::WebviewWindow) {
        let _ = window_vibrancy::apply_acrylic(w, Some((40, 30, 20, 40)));
    }

    pub fn clip(w: &tauri::WebviewWindow) {
        let (Ok(hwnd), Ok(size)) = (w.hwnd(), w.outer_size()) else { return };
        let scale = size.width as f64 / super::SIZE;
        let c = size.width as f64 / 2.0;
        let r = 188.0 * scale; // リング外径(R_OUT+6)
        unsafe {
            let rgn = CreateEllipticRgn((c - r) as i32, (c - r) as i32, (c + r) as i32 + 1, (c + r) as i32 + 1);
            SetWindowRgn(hwnd.0 as _, rgn, 1);
        }
    }
}

/// 画面中央にテスト表示（トレイメニュー用）
pub fn show_center() {
    let Some(app) = APP.get() else { return };
    if let Ok(Some(m)) = app.primary_monitor() {
        let p = m.position();
        let s = m.size();
        show_at(p.x + s.width as i32 / 2, p.y + s.height as i32 / 2);
    }
}
