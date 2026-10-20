use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// ドラッグ中のホイールを使うか
    pub wheel_enabled: bool,
    /// ホイールを出す修飾キー: alt / ctrl / shift / none
    pub trigger: String,
    /// 起動アニメーションを表示するか
    pub splash: bool,
    /// Windows ログイン時に自動起動するか
    pub autostart: bool,
    /// 非可逆形式の品質（10〜100）
    pub quality: u8,
    /// 音声ビットレート(kbps)
    pub audio_bitrate: u32,
    pub strip_metadata: bool,
    /// 保存先（空なら元ファイルと同じフォルダ）
    pub output_dir: Option<String>,
    /// ホイールで変換したあと、完了を通知するか
    pub notify_done: bool,
    /// ホイールに並べる変換先（種別ごと・並び順どおり）
    pub wheel_image: Vec<String>,
    pub wheel_audio: Vec<String>,
    pub wheel_video: Vec<String>,
    /// ホイールで受け付ける入力拡張子
    pub input_exts: Vec<String>,
    /// ホイールの大きさ（0.7〜1.1）
    pub wheel_scale: f32,
    /// 1番目の楔の位置（度、時計回り、0=真上）
    pub wheel_rotation: u16,
    /// 楔に形式名を表示するか
    pub wheel_labels: bool,
    /// 中央にサムネイルを表示するか
    pub wheel_thumb: bool,
}

fn v(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

pub const DEFAULT_INPUT_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "webp", "avif", "tif", "tiff", "bmp", "gif", "heic", "heif", "ico", "tga", "jp2", "jxl",
    "mp3", "wav", "flac", "opus", "m4a", "aac", "ogg", "wma", "aiff", "aif", "ac3", "mp2", "mka", "weba", "amr", "mp4",
    "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "ogv", "vob",
];

impl Default for Settings {
    fn default() -> Self {
        Self {
            wheel_enabled: true,
            trigger: "alt".into(),
            splash: true,
            autostart: false,
            quality: 80,
            audio_bitrate: 192,
            strip_metadata: false,
            output_dir: None,
            notify_done: true,
            wheel_image: v(&["jpg", "png", "webp", "avif", "tiff", "bmp", "gif", "ico"]),
            wheel_audio: v(&["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff"]),
            wheel_video: v(&["mp4", "webm", "mov", "mkv", "avi", "gif", "mp3", "wav"]),
            input_exts: v(DEFAULT_INPUT_EXTS),
            wheel_scale: 1.0,
            wheel_rotation: 0,
            wheel_labels: true,
            wheel_thumb: true,
        }
    }
}

static CURRENT: OnceLock<RwLock<Settings>> = OnceLock::new();
static FIRST_RUN: OnceLock<bool> = OnceLock::new();

fn cell() -> &'static RwLock<Settings> {
    CURRENT.get_or_init(|| RwLock::new(Settings::default()))
}

pub fn get() -> Settings {
    cell().read().map(|s| s.clone()).unwrap_or_default()
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// 起動時に読み込む。ファイルが無ければ初回起動として扱う。
pub fn load(app: &AppHandle) {
    let loaded = path(app).and_then(|p| std::fs::read_to_string(p).ok());
    let _ = FIRST_RUN.set(loaded.is_none());
    if let Some(s) = loaded.and_then(|t| serde_json::from_str::<Settings>(&t).ok()) {
        *cell().write().unwrap() = s;
    }
}

pub fn first_run() -> bool {
    FIRST_RUN.get().copied().unwrap_or(false)
}

pub fn set(app: &AppHandle, mut s: Settings) -> Result<(), String> {
    s.quality = s.quality.clamp(10, 100);
    if !matches!(s.trigger.as_str(), "alt" | "ctrl" | "shift" | "none") {
        s.trigger = "alt".into();
    }
    let d = Settings::default();
    let clean = |list: Vec<String>, known: &[&str], fallback: Vec<String>| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for f in list {
            let f = f.trim().trim_start_matches('.').to_ascii_lowercase();
            if known.contains(&f.as_str()) && !out.contains(&f) {
                out.push(f);
            }
        }
        out.truncate(12);
        if out.len() < 2 { fallback } else { out }
    };
    s.wheel_image = clean(s.wheel_image, dracon_core::IMAGE_FORMATS, d.wheel_image);
    s.wheel_audio = clean(s.wheel_audio, dracon_core::AUDIO_FORMATS, d.wheel_audio);
    s.wheel_video = clean(s.wheel_video, dracon_core::VIDEO_FORMATS, d.wheel_video);
    s.input_exts = clean(s.input_exts, DEFAULT_INPUT_EXTS, vec![]);
    s.wheel_scale = s.wheel_scale.clamp(0.7, 1.1);
    s.wheel_rotation %= 360;
    if s.output_dir.as_deref().is_some_and(|d| d.trim().is_empty()) {
        s.output_dir = None;
    }
    if let Some(p) = path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let text = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
        std::fs::write(p, text).map_err(|e| e.to_string())?;
    }
    *cell().write().unwrap() = s;
    Ok(())
}

/// 修飾キーの仮想キーコード（左右・汎用）
pub fn trigger_keys(trigger: &str) -> &'static [u32] {
    match trigger {
        "alt" => &[0x12, 0xA4, 0xA5],
        "ctrl" => &[0x11, 0xA2, 0xA3],
        "shift" => &[0x10, 0xA0, 0xA1],
        _ => &[],
    }
}
