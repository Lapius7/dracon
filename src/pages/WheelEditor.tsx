import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Settings } from "@/lib/settings";

type Kind = "image" | "audio" | "video";
const KEY = { image: "wheel_image", audio: "wheel_audio", video: "wheel_video" } as const;
const NAME: Record<Kind, string> = { image: "画像", audio: "音声", video: "動画" };
const ALL: Record<Kind, string[]> = {
  image: ["png", "jpg", "webp", "avif", "tiff", "bmp", "gif", "ico", "tga", "jp2"],
  audio: ["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff", "ac3", "wma", "mp2"],
  video: ["mp4", "webm", "mov", "gif", "mkv", "avi", "wmv", "flv", "mpg", "ts", "3gp", "m4v"],
};
const INPUTS: Record<Kind, string[]> = {
  image: ["png", "jpg", "jpeg", "jfif", "webp", "avif", "tif", "tiff", "bmp", "gif", "heic", "heif", "ico", "tga", "jp2", "jxl"],
  audio: ["mp3", "wav", "flac", "opus", "m4a", "aac", "ogg", "wma", "aiff", "aif", "ac3", "mp2", "mka", "weba", "amr"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "ogv", "vob"],
};

export const WHEEL_DEFAULTS: Partial<Settings> = {
  wheel_image: ["jpg", "png", "webp", "avif", "tiff", "bmp", "gif", "ico"],
  wheel_audio: ["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff"],
  wheel_video: ["mp4", "webm", "mov", "mkv", "avi", "gif", "mp3", "wav"],
  input_exts: [...INPUTS.image, ...INPUTS.audio, ...INPUTS.video],
  wheel_scale: 1,
  wheel_rotation: 0,
  wheel_labels: true,
  wheel_thumb: true,
};

const chip = "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium uppercase transition-colors duration-[var(--dur-fast)]";

/** 並び順・配置プレビュー（楔の並びをそのまま見せる） */
function Preview({ list, rot }: { list: string[]; rot: number }) {
  const n = list.length;
  const R = 62, r = 26, g = 0.04, c = 70;
  return (
    <svg viewBox="0 0 140 140" className="size-36 shrink-0" aria-label="ホイールの配置プレビュー">
      {list.map((f, i) => {
        const step = (Math.PI * 2) / n;
        const a0 = -Math.PI / 2 + (rot * Math.PI) / 180 - step / 2 + i * step + g;
        const a1 = a0 + step - g * 2;
        const p = (rad: number, a: number) => `${c + rad * Math.cos(a)} ${c + rad * Math.sin(a)}`;
        const am = (a0 + a1) / 2;
        return (
          <g key={f}>
            <path
              d={`M${p(r, a0)}L${p(R, a0)}A${R} ${R} 0 0 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 0 0 ${p(r, a0)}Z`}
              fill={i === 0 ? "var(--color-accent)" : "var(--color-secondary)"}
              stroke="var(--color-border)"
            />
            <text x={c + 44 * Math.cos(am)} y={c + 44 * Math.sin(am)} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="600" fill={i === 0 ? "oklch(0.2 0.02 285)" : "var(--color-foreground)"}>
              {f.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function WheelEditor({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const [kind, setKind] = useState<Kind>("image");
  const list = s[KEY[kind]];
  const set = (l: string[]) => update({ [KEY[kind]]: l } as Partial<Settings>);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const l = [...list];
    [l[i], l[j]] = [l[j], l[i]];
    set(l);
  };
  const rest = ALL[kind].filter((f) => !list.includes(f));
  const inputs = new Set(s.input_exts);
  const toggleIn = (e: string) => {
    const n = new Set(inputs);
    if (n.has(e)) n.delete(e);
    else n.add(e);
    update({ input_exts: [...n] });
  };

  return (
    <div className="flex flex-col gap-5">
      <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as Kind)} className="self-start">
        {(Object.keys(NAME) as Kind[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="data-[state=on]:bg-[var(--color-accent)] data-[state=on]:font-semibold data-[state=on]:text-[oklch(0.2_0.02_285)]">
            {NAME[k]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex items-start gap-5">
        <Preview list={list} rot={s.wheel_rotation} />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-sm font-medium">変換先（上から時計回りに並びます）</div>
          <ul className="flex flex-col gap-1">
            {list.map((f, i) => (
              <li key={f} className="flex items-center gap-1 rounded-md border border-border bg-secondary/40 py-0.5 pl-2.5 pr-1">
                <span className="tnum w-5 text-xs text-muted-foreground">{i + 1}</span>
                <span className="flex-1 text-sm font-medium uppercase">{f}</span>
                <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${f} を前へ`}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`${f} を後ろへ`}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" disabled={list.length <= 2} onClick={() => set(list.filter((x) => x !== f))} aria-label={`${f} を外す`}>
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          {list.length < 12 && rest.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">追加:</span>
              {rest.map((f) => (
                <button key={f} type="button" onClick={() => set([...list, f])} className={cn(chip, "border-dashed border-border text-muted-foreground hover:border-[var(--color-accent)] hover:text-foreground")}>
                  <Plus className="mr-1 size-3" aria-hidden />
                  {f}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">最大 12 個、最低 2 個。</p>
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">ホイールで受け付けるファイルの拡張子（{NAME[kind]}）</div>
        <p className="mb-2 text-xs text-muted-foreground">オフにした拡張子は、掴んでもホイールが出ません。</p>
        <div className="flex flex-wrap gap-1.5">
          {INPUTS[kind].map((e) => {
            const on = inputs.has(e);
            return (
              <button
                key={e}
                type="button"
                aria-pressed={on}
                onClick={() => toggleIn(e)}
                className={cn(chip, on ? "border-transparent bg-[var(--color-accent)] text-[oklch(0.2_0.02_285)]" : "border-border text-muted-foreground line-through hover:text-foreground")}
              >
                .{e}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-6">
          <div className="text-sm font-medium">大きさ</div>
          <div className="flex w-56 items-center gap-3">
            <Slider min={70} max={110} step={5} value={[Math.round(s.wheel_scale * 100)]} onValueChange={(v) => update({ wheel_scale: v[0] / 100 })} aria-label="ホイールの大きさ" />
            <span className="tnum w-10 text-right text-sm text-muted-foreground">{Math.round(s.wheel_scale * 100)}%</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-sm font-medium">1番目の位置</div>
            <div className="mt-0.5 text-xs text-muted-foreground">1番目の楔を置く角度（時計回り）。</div>
          </div>
          <div className="flex w-56 items-center gap-3">
            <Slider min={0} max={345} step={15} value={[s.wheel_rotation]} onValueChange={(v) => update({ wheel_rotation: v[0] })} aria-label="1番目の位置" />
            <span className="tnum w-10 text-right text-sm text-muted-foreground">{s.wheel_rotation}°</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="text-sm font-medium">楔に形式名を表示</div>
          <Switch checked={s.wheel_labels} onCheckedChange={(v) => update({ wheel_labels: v })} aria-label="形式名を表示" />
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="text-sm font-medium">中央にサムネイルを表示</div>
          <Switch checked={s.wheel_thumb} onCheckedChange={(v) => update({ wheel_thumb: v })} aria-label="サムネイルを表示" />
        </div>
      </div>
    </div>
  );
}
