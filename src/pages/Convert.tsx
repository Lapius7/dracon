import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertCircle, Check, FileAudio, FileImage, FileVideo, FilePlus2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";

type Kind = "image" | "audio" | "video";
type Probe = { path: string; name: string; kind: Kind | null; size: number };
type Result = { output?: string; error?: string };
type ProgressEvent = { index: number; total: number; input: string; output: string | null; error: string | null };

const FORMATS: Record<Kind, string[]> = {
  image: ["png", "jpg", "webp", "avif", "tiff", "bmp", "gif", "ico", "tga", "jp2"],
  audio: ["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff", "ac3", "wma", "mp2"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "wmv", "flv", "mpg", "ts", "3gp", "m4v", "gif", "mp3", "m4a", "wav", "flac", "aac"],
};
const HAS_QUALITY = new Set(["jpg", "webp", "avif", "mp4", "webm", "mov", "mkv", "avi", "wmv", "flv", "mpg", "ts", "3gp", "m4v"]);
const HAS_BITRATE = new Set(["mp3", "opus", "m4a", "ogg", "aac", "ac3", "wma", "mp2"]);
const ICON = { image: FileImage, audio: FileAudio, video: FileVideo } as const;

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function Convert() {
  const [settings] = useSettings();
  const [files, setFiles] = useState<Probe[]>([]);
  const [format, setFormat] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [bitrate, setBitrate] = useState<number | null>(null);
  const [strip, setStrip] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [over, setOver] = useState(false);

  const q = quality ?? settings?.quality ?? 80;
  const br = bitrate ?? settings?.audio_bitrate ?? 192;
  const st = strip ?? settings?.strip_metadata ?? false;
  const kind = files.find((f) => f.kind)?.kind ?? null;
  const formats = kind ? FORMATS[kind] : [];
  const done = Object.keys(results).length;

  const addPaths = useCallback(async (paths: string[]) => {
    const probed = await invoke<Probe[]>("probe", { paths });
    setFiles((cur) => {
      const seen = new Set(cur.map((f) => f.path));
      return [...cur, ...probed.filter((p) => !seen.has(p.path))];
    });
    setResults({});
  }, []);

  useEffect(() => {
    if (kind && !formats.includes(format)) setFormat(formats[0]);
  }, [kind, formats, format]);

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over") setOver(true);
      else if (e.payload.type === "drop") {
        setOver(false);
        void addPaths(e.payload.paths);
      } else setOver(false);
    });
    const un2 = listen<ProgressEvent>("dracon://progress", (e) => {
      const p = e.payload;
      setResults((r) => ({ ...r, [p.input]: { output: p.output ?? undefined, error: p.error ?? undefined } }));
    });
    return () => {
      void un.then((f) => f());
      void un2.then((f) => f());
    };
  }, [addPaths]);

  const pick = async () => {
    const sel = await open({ multiple: true });
    if (sel) await addPaths(Array.isArray(sel) ? sel : [sel]);
  };

  const run = async () => {
    setBusy(true);
    setResults({});
    try {
      await invoke("convert", {
        inputs: files.filter((f) => f.kind).map((f) => f.path),
        options: {
          format,
          quality: HAS_QUALITY.has(format) ? q : null,
          audio_bitrate: HAS_BITRATE.has(format) || kind === "video" ? br : null,
          gif_width: null,
          gif_fps: null,
          strip_metadata: st,
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const convertible = useMemo(() => files.filter((f) => f.kind).length, [files]);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">変換</h1>
        <p className="mt-1 text-sm text-muted-foreground">画像・音声・動画をこの PC 内で変換します。ファイルは外部に送信されません。</p>
      </header>

      <button
        type="button"
        onClick={pick}
        className={cn(
          "group relative flex h-40 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-border bg-card text-sm text-muted-foreground transition-[border-color,background-color,color] duration-200 hover:border-primary/60 hover:bg-secondary hover:text-foreground",
          over && "border-primary bg-secondary text-foreground",
        )}
      >
        <span className="grid size-11 place-items-center rounded-full bg-secondary transition-transform duration-300 group-hover:scale-110 group-hover:text-primary">
          <FilePlus2 className="size-5" aria-hidden />
        </span>
        <span>ここにファイルをドロップ、またはクリックして選択</span>
      </button>

      {files.length > 0 && (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {files.map((f) => {
              const r = results[f.path];
              const Icon = f.kind ? ICON[f.kind] : FileImage;
              return (
                <li key={f.path} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={f.path}>{f.name}</span>
                  <span className="tnum text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                  {!f.kind && <Badge variant="secondary">非対応</Badge>}
                  {r?.output && (
                    <button type="button" onClick={() => revealItemInDir(r.output!)} className="flex items-center gap-1 text-xs text-[var(--color-ok)] hover:underline">
                      <Check className="size-4" aria-hidden />フォルダを開く
                    </button>
                  )}
                  {r?.error && (
                    <span className="flex max-w-48 items-center gap-1 truncate text-xs text-destructive" title={r.error}>
                      <AlertCircle className="size-4 shrink-0" aria-hidden />失敗
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`${f.name} を一覧から外す`}
                    disabled={busy}
                    onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-40"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {convertible > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-medium" htmlFor="fmt">変換先の形式</label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger id="fmt" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {formats.map((f) => <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {HAS_QUALITY.has(format) && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">品質</span>
                <div className="flex w-60 items-center gap-3">
                  <Slider min={10} max={100} step={5} value={[q]} onValueChange={(v) => setQuality(v[0])} aria-label="品質" />
                  <span className="tnum w-8 text-right text-sm text-muted-foreground">{q}</span>
                </div>
              </div>
            )}
            {HAS_BITRATE.has(format) && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">音声ビットレート</span>
                <div className="flex w-60 items-center gap-3">
                  <Slider min={64} max={320} step={32} value={[br]} onValueChange={(v) => setBitrate(v[0])} aria-label="音声ビットレート" />
                  <span className="tnum w-16 text-right text-sm text-muted-foreground">{br} kbps</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-medium" htmlFor="strip">メタデータを削除</label>
              <Switch id="strip" checked={st} onCheckedChange={setStrip} />
            </div>
          </CardContent>
        </Card>
      )}

      {busy && <Progress value={(done / Math.max(convertible, 1)) * 100} aria-label="変換の進捗" />}

      <Button size="lg" disabled={busy || convertible === 0 || !format} onClick={run} className="mt-auto h-11">
        {busy ? `変換中 ${done} / ${convertible}` : convertible ? `${convertible} 件を ${format.toUpperCase()} に変換` : "ファイルを追加してください"}
      </Button>
    </>
  );
}
