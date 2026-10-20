<div align="center">

# Dracon

A small Windows app that converts images, audio and video on your own PC.

[![Release](https://img.shields.io/github/v/release/Lapius7/dracon?style=flat-square&color=7c5cff)](https://github.com/Lapius7/dracon/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-3b3e44?style=flat-square)

**English** · [日本語](README.ja.md)

</div>

Nothing is uploaded. Every conversion runs locally with a bundled ffmpeg.

## Features

- Drag files, hold **Alt**, move toward a wedge of the radial menu and release to convert
- Output is saved next to the source file
- Images: PNG, JPG, WebP, AVIF, TIFF, BMP, GIF
- Audio: MP3, WAV, FLAC, Opus, M4A, OGG
- Video: MP4, WebM, MOV, GIF, and audio extraction
- Optional metadata removal
- Lives in the tray; optional start with Windows
- Auto update: **Info** page → *Check for updates* (signed updates from GitHub Releases)

## Install

Download `Dracon_x.y.z_x64-setup.exe` from [Releases](https://github.com/Lapius7/dracon/releases/latest) and run it. Later versions can be installed from inside the app.

## Development

Built with Tauri 2, React and Rust.

```sh
pnpm install
cargo test -p dracon-core
pnpm tauri dev
```

Put a Windows `ffmpeg.exe` in `src-tauri/resources/` before building. Without it, `ffmpeg` on PATH is used.

Releases are built by the `build` GitHub Actions workflow, which signs the update with `TAURI_SIGNING_PRIVATE_KEY`.
