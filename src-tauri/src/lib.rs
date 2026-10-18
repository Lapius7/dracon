mod wheel;
use mikan_core::{build_args, kind_of, output_path, Options};
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
fn probe(paths: Vec<String>) -> Vec<Probe> {
    paths
        .into_iter()
        .map(|p| {
            let path = Path::new(&p);
            Probe {
                name: path.file_name().and_then(|n| n.to_str()).unwrap_or(&p).to_string(),
                kind: kind_of(path).map(|k| format!("{k:?}").to_lowercase()),
                path: p,
            }
        })
        .collect()
}

#[tauri::command]
async fn convert(app: AppHandle, inputs: Vec<String>, options: Options) -> Result<(), String> {
    let ffmpeg = ffmpeg_path(&app);
    let total = inputs.len();
    tauri::async_runtime::spawn_blocking(move || {
        for (index, input) in inputs.iter().enumerate() {
            let inp = Path::new(input);
            let out = output_path(inp, &options.format, |p| p.exists());
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
            let _ = app.emit(
                "mikan://progress",
                Progress {
                    index,
                    total,
                    input: input.clone(),
                    output: result.is_ok().then(|| out.display().to_string()),
                    error: result.err(),
                },
            );
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn wheel_busy(busy: bool) {
    wheel::BUSY.store(busy, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
fn wheel_hide() {
    wheel::hide();
}

pub fn run() {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![probe, convert, wheel_busy, wheel_hide])
        .setup(|app| {
            wheel::create(app.handle())?;
            let open = MenuItem::with_id(app, "open", "mikan を開く", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("mikan（Alt を押しながらドラッグで円形メニュー）")
                .menu(&menu)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|win, e| {
            // メインウィンドウは閉じてもトレイに常駐する
            if win.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    let _ = win.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
