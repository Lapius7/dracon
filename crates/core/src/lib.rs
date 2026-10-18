//! ffmpeg 引数の組み立て。Tauri に依存しない純粋なロジック。
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Audio,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Options {
    /// 出力拡張子（小文字、ドットなし）
    pub format: String,
    /// 画質 1-100（画像・動画の品質指定。未指定は既定値）
    pub quality: Option<u8>,
    /// 音声ビットレート kbps
    pub audio_bitrate: Option<u32>,
    /// GIF の最大幅 / フレームレート
    pub gif_width: Option<u32>,
    pub gif_fps: Option<u32>,
    /// メタデータを除去する
    pub strip_metadata: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            format: "png".into(),
            quality: None,
            audio_bitrate: None,
            gif_width: None,
            gif_fps: None,
            strip_metadata: false,
        }
    }
}

pub const IMAGE_FORMATS: &[&str] = &["png", "jpg", "webp", "avif", "tiff", "bmp", "gif", "ico", "tga", "jp2"];
pub const AUDIO_FORMATS: &[&str] = &["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff", "ac3", "wma", "mp2"];
pub const VIDEO_FORMATS: &[&str] = &["mp4", "webm", "mov", "gif", "mkv", "avi", "wmv", "flv", "mpg", "ts", "3gp", "m4v"];

/// 入力拡張子から種別を判定
pub fn kind_of(path: &Path) -> Option<Kind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "jfif" | "webp" | "avif" | "tif" | "tiff" | "bmp" | "gif" | "heic" | "heif" | "ico"
        | "tga" | "jp2" | "jxl" => {
            Some(Kind::Image)
        }
        "mp3" | "wav" | "flac" | "opus" | "m4a" | "aac" | "ogg" | "wma" | "aiff" | "aif" | "ac3" | "mp2" | "mka"
        | "weba" | "amr" => Some(Kind::Audio),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "wmv" | "flv" | "mpg" | "mpeg" | "ts" | "mts" | "m2ts"
        | "3gp" | "ogv" | "vob" => Some(Kind::Video),
        _ => None,
    }
}

/// 出力パス: 同じフォルダに `<名前>.<形式>`。衝突時は ` (n)` を付ける。
pub fn output_path(input: &Path, format: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let dir = input.parent().unwrap_or(Path::new("."));
    let mut p = dir.join(format!("{stem}.{format}"));
    let mut n = 1;
    while p == input || exists(&p) {
        p = dir.join(format!("{stem} ({n}).{format}"));
        n += 1;
    }
    p
}

#[derive(Debug, PartialEq, Eq)]
pub enum PlanError {
    UnknownInput,
    Unsupported(String),
}

/// ffmpeg に渡す引数列（実行ファイル名は含まない）
pub fn build_args(input: &Path, output: &Path, opts: &Options) -> Result<Vec<String>, PlanError> {
    let kind = kind_of(input).ok_or(PlanError::UnknownInput)?;
    let fmt = opts.format.as_str();
    let ok = match kind {
        Kind::Image => IMAGE_FORMATS.contains(&fmt),
        Kind::Audio => AUDIO_FORMATS.contains(&fmt),
        Kind::Video => VIDEO_FORMATS.contains(&fmt) || AUDIO_FORMATS.contains(&fmt),
    };
    if !ok {
        return Err(PlanError::Unsupported(format!("{kind:?} -> {fmt}")));
    }

    let s = |x: &str| x.to_string();
    let mut a = vec![s("-hide_banner"), s("-loglevel"), s("error"), s("-y"), s("-i"), input.display().to_string()];

    if opts.strip_metadata {
        a.extend([s("-map_metadata"), s("-1"), s("-map_chapters"), s("-1")]);
    }

    // 動画 → 音声形式（音声抽出）
    let audio_out = AUDIO_FORMATS.contains(&fmt) && kind == Kind::Video;
    if audio_out {
        a.push(s("-vn"));
    }

    match fmt {
        "png" => a.extend([s("-compression_level"), s("9")]),
        "jpg" => {
            let q = quality_to_qscale(opts.quality.unwrap_or(90));
            a.extend([s("-q:v"), q.to_string(), s("-pix_fmt"), s("yuvj420p")]);
        }
        "webp" => a.extend([s("-c:v"), s("libwebp"), s("-quality"), opts.quality.unwrap_or(85).to_string()]),
        "avif" => a.extend([s("-c:v"), s("libaom-av1"), s("-crf"), crf(opts.quality.unwrap_or(80)).to_string(), s("-b:v"), s("0")]),
        "tiff" | "bmp" | "tga" => {}
        "jp2" => a.extend([s("-c:v"), s("jpeg2000")]),
        "ico" => a.extend([s("-vf"), s("scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease")]),
        "gif" if kind == Kind::Video => {
            let w = opts.gif_width.unwrap_or(480);
            let fps = opts.gif_fps.unwrap_or(12);
            a.extend([
                s("-vf"),
                format!("fps={fps},scale='min({w},iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"),
            ]);
        }
        "gif" => {}
        "mp3" => a.extend([s("-c:a"), s("libmp3lame"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192))]),
        "wav" => a.extend([s("-c:a"), s("pcm_s16le")]),
        "flac" => a.extend([s("-c:a"), s("flac")]),
        "opus" => a.extend([s("-c:a"), s("libopus"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(128))]),
        "ogg" => a.extend([s("-c:a"), s("libvorbis"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(160))]),
        "m4a" => a.extend([s("-c:a"), s("aac"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192)), s("-movflags"), s("+faststart")]),
        "aac" => a.extend([s("-c:a"), s("aac"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192)), s("-f"), s("adts")]),
        "aiff" => a.extend([s("-c:a"), s("pcm_s16be")]),
        "ac3" => a.extend([s("-c:a"), s("ac3"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192))]),
        "wma" => a.extend([s("-c:a"), s("wmav2"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192))]),
        "mp2" => a.extend([s("-c:a"), s("mp2"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192))]),
        "wmv" => a.extend([
            s("-c:v"), s("wmv2"), s("-q:v"), quality_to_qscale(opts.quality.unwrap_or(75)).to_string(),
            s("-c:a"), s("wmav2"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192)),
        ]),
        "flv" => a.extend([
            s("-c:v"), s("flv"), s("-q:v"), quality_to_qscale(opts.quality.unwrap_or(75)).to_string(),
            s("-c:a"), s("libmp3lame"), s("-ar"), s("44100"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(128)),
        ]),
        "mpg" => a.extend([
            s("-c:v"), s("mpeg2video"), s("-q:v"), quality_to_qscale(opts.quality.unwrap_or(75)).to_string(),
            s("-c:a"), s("mp2"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192)),
        ]),
        "mp4" | "mov" | "mkv" | "avi" | "ts" | "3gp" | "m4v" => a.extend([
            s("-c:v"), s("libx264"), s("-crf"), crf(opts.quality.unwrap_or(75)).to_string(),
            s("-pix_fmt"), s("yuv420p"), s("-c:a"), s("aac"),
            s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(192)),
            s("-movflags"), s("+faststart"),
        ]),
        "webm" => a.extend([
            s("-c:v"), s("libvpx-vp9"), s("-crf"), crf(opts.quality.unwrap_or(75)).to_string(), s("-b:v"), s("0"),
            s("-c:a"), s("libopus"), s("-b:a"), format!("{}k", opts.audio_bitrate.unwrap_or(128)),
        ]),
        _ => return Err(PlanError::Unsupported(fmt.to_string())),
    }

    a.push(output.display().to_string());
    Ok(a)
}

/// 品質 1-100 → ffmpeg JPEG qscale (2=高画質 .. 31=低画質)
fn quality_to_qscale(q: u8) -> u32 {
    let q = q.clamp(1, 100) as f32;
    (31.0 - (q / 100.0) * 29.0).round().clamp(2.0, 31.0) as u32
}

/// 品質 1-100 → CRF (高品質ほど小さい値)
fn crf(q: u8) -> u32 {
    let q = q.clamp(1, 100) as f32;
    (51.0 - (q / 100.0) * 33.0).round().clamp(18.0, 51.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(f: &str) -> Options {
        Options { format: f.into(), ..Default::default() }
    }

    #[test]
    fn detects_kinds() {
        assert_eq!(kind_of(Path::new("a.HEIC")), Some(Kind::Image));
        assert_eq!(kind_of(Path::new("a.mkv")), Some(Kind::Video));
        assert_eq!(kind_of(Path::new("a.xyz")), None);
    }

    #[test]
    fn output_avoids_collision() {
        let p = output_path(Path::new("/x/a.png"), "png", |_| false);
        assert_eq!(p, PathBuf::from("/x/a (1).png"));
        let p = output_path(Path::new("/x/a.png"), "jpg", |q| q == Path::new("/x/a.jpg"));
        assert_eq!(p, PathBuf::from("/x/a (1).jpg"));
    }

    #[test]
    fn gif_from_video_uses_palette() {
        let a = build_args(Path::new("a.mp4"), Path::new("a.gif"), &opts("gif")).unwrap();
        assert!(a.iter().any(|x| x.contains("palettegen") && x.contains("paletteuse")));
    }

    #[test]
    fn strip_metadata_adds_flags() {
        let o = Options { strip_metadata: true, ..opts("jpg") };
        let a = build_args(Path::new("a.png"), Path::new("a.jpg"), &o).unwrap();
        assert!(a.windows(2).any(|w| w == ["-map_metadata", "-1"]));
    }

    #[test]
    fn video_to_audio_drops_video() {
        let a = build_args(Path::new("a.mp4"), Path::new("a.mp3"), &opts("mp3")).unwrap();
        assert!(a.contains(&"-vn".to_string()));
    }

    #[test]
    fn new_formats_have_plans() {
        for (i, f) in [("a.png", "ico"), ("a.png", "tga"), ("a.png", "jp2"), ("a.wav", "aac"), ("a.wav", "wma"),
                       ("a.mp4", "mkv"), ("a.mp4", "avi"), ("a.mp4", "wmv"), ("a.mp4", "flv"), ("a.mp4", "ts")] {
            assert!(build_args(Path::new(i), Path::new("o"), &opts(f)).is_ok(), "{i} -> {f}");
        }
        assert!(IMAGE_FORMATS.iter().chain(AUDIO_FORMATS).chain(VIDEO_FORMATS).all(|f| {
            let i = if IMAGE_FORMATS.contains(f) { "a.png" } else if AUDIO_FORMATS.contains(f) { "a.wav" } else { "a.mp4" };
            build_args(Path::new(i), Path::new("o"), &opts(f)).is_ok()
        }));
    }

    #[test]
    fn rejects_bad_combos() {
        assert!(build_args(Path::new("a.png"), Path::new("a.mp3"), &opts("mp3")).is_err());
        assert_eq!(build_args(Path::new("a.zip"), Path::new("a.png"), &opts("png")), Err(PlanError::UnknownInput));
    }

    #[test]
    fn quality_mapping_is_monotonic() {
        assert!(crf(100) < crf(10));
        assert!(quality_to_qscale(100) < quality_to_qscale(10));
    }
}
