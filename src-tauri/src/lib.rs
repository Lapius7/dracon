mod settings;
mod wheel;
use dracon_core::{build_args, kind_of, output_path, Options};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct Progress {
    index: usize,
    total: usize,
    input: String,
    output: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct Probe {
    path: String,
    name: String,
    kind: Option<String>,
    size: u64,
}

/// 同梱 ffmpeg（resources/ffmpeg.exe）を優先し、無ければ PATH の ffmpeg を使う
fn ffmpeg_path(app: &AppHandle) -> PathBuf {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("resources").join(name);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(name)
}

#[tauri::command]
fn probe(paths: Vec<String>, wheel: Option<bool>) -> Vec<Probe> {
    let allowed = settings::get().input_exts;
    let wheel = wheel.unwrap_or(false);
    paths
        .into_iter()
        .map(|p| {
            let path = Path::new(&p);
            Probe {
                name: path.file_name().and_then(|n| n.to_str()).unwrap_or(&p).to_string(),
                kind: kind_of(path)
                    .filter(|_| {
                        !wheel
                            || path
                                .extension()
                                .and_then(|e| e.to_str())
                                .is_some_and(|e| allowed.contains(&e.to_ascii_lowercase()))
                    })
                    .map(|k| format!("{k:?}").to_lowercase()),
                size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
                path: p,
            }
        })
        .collect()
}

#[tauri::command]
async fn convert(app: AppHandle, inputs: Vec<String>, options: Options, notify: Option<bool>) -> Result<(), String> {
    let ffmpeg = ffmpeg_path(&app);
    let total = inputs.len();
    let out_dir = settings::get().output_dir.map(PathBuf::from).filter(|d| d.is_dir());
    let handle = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut ok_count = 0usize;
        for (index, input) in inputs.iter().enumerate() {
            let inp = Path::new(input);
            let basis = match (&out_dir, inp.file_name()) {
                (Some(d), Some(n)) => d.join(n),
                _ => inp.to_path_buf(),
            };
            let out = output_path(&basis, &options.format, |p| p.exists());
            let result = build_args(inp, &out, &options)
                .map_err(|e| format!("{e:?}"))
                .and_then(|args| {
                    let mut cmd = Command::new(&ffmpeg);
                    cmd.args(args);
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                    }
                    let o = cmd.output().map_err(|e| format!("ffmpeg を起動できません: {e}"))?;
                    if o.status.success() {
                        Ok(())
                    } else {
                        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
                    }
                });
            if result.is_ok() {
                ok_count += 1;
            }
            let _ = app.emit(
                "dracon://progress",
                Progress {
                    index,
                    total,
                    input: input.clone(),
                    output: result.is_ok().then(|| out.display().to_string()),
                    error: result.err(),
                },
            );
        }
        ok_count
    })
    .await
    .map_err(|e| e.to_string())?;
    if notify.unwrap_or(false) && settings::get().notify_done {
        use tauri_plugin_notification::NotificationExt;
        let _ = handle
            .notification()
            .builder()
            .title("Dracon")
            .body(if res == total { format!("{total} 件の変換が完了しました") } else { format!("{res} / {total} 件を変換しました（失敗あり）") })
            .show();
    }
    Ok(())
}

#[tauri::command]
fn get_settings() -> settings::Settings {
    settings::get()
}

#[tauri::command]
fn set_settings(app: AppHandle, value: settings::Settings) -> Result<(), String> {
    let before = settings::get();
    settings::set(&app, value)?;
    let now = settings::get();
    if before.autostart != now.autostart {
        use tauri_plugin_autostart::ManagerExt;
        let m = app.autolaunch();
        let _ = if now.autostart { m.enable() } else { m.disable() };
    }
    tray::sync(&now);
    let _ = app.emit("dracon://settings", now);
    Ok(())
}

#[tauri::command]
fn open_window(app: AppHandle, page: Option<String>) {
    open_main(&app, page.as_deref().unwrap_or("convert"));
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({ "version": env!("CARGO_PKG_VERSION") })
}

/// メインウィンドウ（変換 / 設定 / 情報）を開く。既にあれば前面に出してページを切り替える。
pub fn open_main(app: &AppHandle, page: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = app.emit("dracon://navigate", page);
        return;
    }
    let url = format!("index.html#{page}");
    let _ = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App(url.into()))
        .title("Dracon")
        .inner_size(880.0, 620.0)
        .min_inner_size(720.0, 520.0)
        .center()
        .focused(true)
        .build()
        .map(|w| {
            // 前面に出す（他アプリの裏に隠れないように、一瞬だけ最前面にする）
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
            let _ = w.set_always_on_top(false);
        });
}

mod tray {
    use super::*;
    use std::sync::OnceLock;
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    static WHEEL_ITEM: OnceLock<CheckMenuItem<tauri::Wry>> = OnceLock::new();

    pub fn sync(s: &settings::Settings) {
        if let Some(i) = WHEEL_ITEM.get() {
            let _ = i.set_checked(s.wheel_enabled);
        }
    }

    pub fn build(app: &tauri::App) -> tauri::Result<()> {
        let st = settings::get();
        let title = MenuItem::with_id(app, "title", "Dracon", false, None::<&str>)?;
        let wheel = CheckMenuItem::with_id(app, "wheel", "ドラッグ ホイールを有効にする", true, st.wheel_enabled, None::<&str>)?;
        let _ = WHEEL_ITEM.set(wheel.clone());
        let convert = MenuItem::with_id(app, "convert", "ファイルを変換…", true, None::<&str>)?;
        let prefs = MenuItem::with_id(app, "settings", "設定", true, None::<&str>)?;
        let about = MenuItem::with_id(app, "about", "Dracon について", true, None::<&str>)?;
        let test = MenuItem::with_id(app, "test", "ホイールを試す", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
        let sep = || PredefinedMenuItem::separator(app);
        let menu = Menu::with_items(app, &[&title, &sep()?, &wheel, &test, &sep()?, &convert, &prefs, &about, &sep()?, &quit])?;
        let mut tray = TrayIconBuilder::with_id("dracon")
            .tooltip("Dracon  ―  ファイルを掴んで Alt でホイール")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "wheel" => {
                    let mut s = settings::get();
                    s.wheel_enabled = !s.wheel_enabled;
                    let _ = set_settings(app.clone(), s);
                }
                "test" => wheel::show_center(),
                "convert" => open_main(app, "convert"),
                "settings" => open_main(app, "settings"),
                "about" => open_main(app, "about"),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|t, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    open_main(t.app_handle(), "convert");
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn wheel_busy(busy: bool) {
    wheel::BUSY.store(busy, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
fn wheel_log(msg: String) {
    wheel::log(&format!("js: {msg}"));
}

#[tauri::command]
fn wheel_reject() {
    wheel::reject();
}

#[tauri::command]
fn wheel_hide() {
    wheel::hide();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--background"])))
        .invoke_handler(tauri::generate_handler![
            probe, convert, wheel_busy, wheel_hide, wheel_reject, wheel_log, get_settings, set_settings, open_window, app_info
        ])
        .setup(|app| {
            settings::load(app.handle());
            wheel::create(app.handle())?;
            tray::build(app)?;
            if settings::first_run() {
                open_main(app.handle(), "settings");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, e| {
            // ウィンドウが無くてもトレイに常駐する（終了はトレイから）
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = e {
                api.prevent_exit();
            }
        });
}
