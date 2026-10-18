# mikan

画像・音声・動画を、自分の PC の中だけで変換する Windows 向けの小さなアプリです。ファイルは外部に送信されません。

- ファイルをドロップし、形式を選んで変換します。出力は元のファイルと同じフォルダに保存されます。
- 画像: PNG、JPG、WebP、AVIF、TIFF、BMP、GIF
- 音声: MP3、WAV、FLAC、Opus、M4A、OGG
- 動画: MP4、WebM、MOV、GIF、音声の抽出
- メタデータの削除（任意）

Tauri 2、React、同梱の ffmpeg で作られています。

## 開発

```
pnpm install
cargo test -p mikan-core
pnpm tauri dev
```

ビルド前に、Windows 用の `ffmpeg.exe` を `src-tauri/resources/` に置いてください。置かない場合は、PATH 上の `ffmpeg` を使います。
