# Dracon

A small Windows app that converts images, audio and video on your own PC. Nothing is uploaded.

- Drop files, pick a format, convert. Output is saved next to the source file.
- Images: PNG, JPG, WebP, AVIF, TIFF, BMP, GIF
- Audio: MP3, WAV, FLAC, Opus, M4A, OGG
- Video: MP4, WebM, MOV, GIF, and audio extraction
- Optional metadata removal

Built with Tauri 2, React and a bundled ffmpeg.

## Development

```
pnpm install
cargo test -p dracon-core
pnpm tauri dev
```

Put a Windows `ffmpeg.exe` in `src-tauri/resources/` before building. On a machine without it, a `ffmpeg` found on PATH is used.
