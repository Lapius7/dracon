import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { useSettings, type Settings } from "@/lib/settings";
import WheelEditor, { WHEEL_DEFAULTS } from "@/pages/WheelEditor";
import type { ReactNode } from "react";

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const DEFAULTS: Partial<Settings> = {
  wheel_enabled: true,
  trigger: "alt",
  splash: true,
  autostart: false,
  quality: 80,
  audio_bitrate: 192,
  strip_metadata: false,
  output_dir: null,
  notify_done: true,
  ...WHEEL_DEFAULTS,
};

export default function SettingsPage() {
  const [s, update] = useSettings();
  if (!s) return null;

  const chooseDir = async () => {
    const d = await open({ directory: true });
    if (typeof d === "string") update({ output_dir: d });
  };

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">設定</h1>
          <p className="mt-1 text-sm text-muted-foreground">変更はすぐに保存されます。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => update(DEFAULTS)}>
          <RotateCcw className="size-4" aria-hidden />初期値に戻す
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>ドラッグ ホイール</CardTitle>
          <CardDescription>ファイルを掴んだときに、円形の変換メニューを表示します。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row title="ホイールを有効にする" hint="オフにすると、ファイルを掴んでもメニューは出ません（アプリ本体の変換画面は使えます）。">
            <Switch checked={s.wheel_enabled} onCheckedChange={(v) => update({ wheel_enabled: v })} aria-label="ホイールを使う" />
          </Row>
          <Separator />
          <Row title="表示するキー" hint="ファイルを掴んでいる間にこのキーを押すと表示します。">
            <ToggleGroup
              type="single"
              variant="outline"
              value={s.trigger}
              disabled={!s.wheel_enabled}
              onValueChange={(v) => v && update({ trigger: v as Settings["trigger"] })}
            >
              <ToggleGroupItem className="data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-[oklch(0.2_0.02_285)] data-[state=on]:font-semibold" value="alt">Alt</ToggleGroupItem>
              <ToggleGroupItem className="data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-[oklch(0.2_0.02_285)] data-[state=on]:font-semibold" value="ctrl">Ctrl</ToggleGroupItem>
              <ToggleGroupItem className="data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-[oklch(0.2_0.02_285)] data-[state=on]:font-semibold" value="shift">Shift</ToggleGroupItem>
              <ToggleGroupItem className="data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-[oklch(0.2_0.02_285)] data-[state=on]:font-semibold" value="none">常に表示</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          {s.trigger === "none" && (
            <p className="text-xs text-[var(--color-danger)]">「常に」だと、普通のファイル移動のドラッグでもホイールが出ます。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ホイールの中身</CardTitle>
          <CardDescription>変換先の形式・並び順・受け付ける拡張子・見た目を決めます。</CardDescription>
        </CardHeader>
        <CardContent>
          <WheelEditor s={s} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>変換</CardTitle>
          <CardDescription>ホイールと変換画面で使う初期値です。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row title="品質" hint="JPG・WebP・AVIF・動画など">
            <div className="flex w-56 items-center gap-3">
              <Slider min={10} max={100} step={5} value={[s.quality]} onValueChange={(v) => update({ quality: v[0] })} aria-label="品質" />
              <span className="tnum w-8 text-right text-sm text-muted-foreground">{s.quality}</span>
            </div>
          </Row>
          <Separator />
          <Row title="音声ビットレート" hint="MP3・AAC・Opus など">
            <div className="flex w-56 items-center gap-3">
              <Slider min={64} max={320} step={32} value={[s.audio_bitrate]} onValueChange={(v) => update({ audio_bitrate: v[0] })} aria-label="音声ビットレート" />
              <span className="tnum w-16 text-right text-sm text-muted-foreground">{s.audio_bitrate} kbps</span>
            </div>
          </Row>
          <Separator />
          <Row title="メタデータを削除">
            <Switch checked={s.strip_metadata} onCheckedChange={(v) => update({ strip_metadata: v })} aria-label="メタデータを削除" />
          </Row>
          <Separator />
          <Row title="保存先" hint={s.output_dir ?? "元のファイルと同じフォルダ"}>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={chooseDir}>
                <FolderOpen className="size-4" aria-hidden />選ぶ
              </Button>
              {s.output_dir && (
                <Button variant="ghost" size="sm" onClick={() => update({ output_dir: null })}>元に戻す</Button>
              )}
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>アプリ</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row title="ログイン時に自動で起動する" hint="タスクトレイに常駐します。">
            <Switch checked={s.autostart} onCheckedChange={(v) => update({ autostart: v })} aria-label="自動で起動する" />
          </Row>
          <Separator />
          <Row title="起動アニメーションを表示">
            <Switch checked={s.splash} onCheckedChange={(v) => update({ splash: v })} aria-label="起動アニメーション" />
          </Row>
          <Separator />
          <Row title="変換が終わったら通知する" hint="ホイールからの変換が終わったときに表示します。">
            <Switch checked={s.notify_done} onCheckedChange={(v) => update({ notify_done: v })} aria-label="完了通知" />
          </Row>
        </CardContent>
      </Card>
    </>
  );
}
