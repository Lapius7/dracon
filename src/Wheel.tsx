import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type Probe = { path: string; name: string; kind: string | null };

// 実装済みの形式だけを並べる（未実装の PDF / DOCX / HEIC は出さない）
const SLICES = ["jpg", "png", "webp", "avif", "tiff", "bmp", "mp4", "mp3"] as const;
const VALID: Record<string, string[]> = {
  image: ["png", "jpg", "webp", "avif", "tiff", "bmp", "gif"],
  audio: ["mp3", "wav", "flac", "opus", "m4a", "ogg"],
  video: ["mp4", "webm", "mov", "gif", "mp3", "m4a"],
};
const HAS_QUALITY = new Set(["jpg", "webp", "avif", "mp4", "webm", "mov"]);

const R_OUT = 170;
const R_IN = 62;
const GAP = 0.025;

function arc(i: number, n: number) {
  const step = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 - step / 2 + i * step + GAP;
  const a1 = a0 + step - GAP * 2;
  const p = (r: number, a: number) => `${(190 + r * Math.cos(a)).toFixed(2)} ${(190 + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(R_IN, a0)} L ${p(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)} L ${p(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)} Z`;
}

function labelPos(i: number, n: number) {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
  const r = (R_IN + R_OUT) / 2;
  return { x: 190 + r * Math.cos(a), y: 190 + r * Math.sin(a) };
}

export default function Wheel() {
  const [hover, setHover] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const busy = useRef(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    const pick = (x: number, y: number) => {
      const dpr = window.devicePixelRatio || 1;
      const dx = x / dpr - 190;
      const dy = y / dpr - 190;
      const r = Math.hypot(dx, dy);
      if (r < R_IN || r > R_OUT) return null;
      const n = SLICES.length;
      const a = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n + Math.PI * 4) % (Math.PI * 2);
      return Math.floor(a / ((Math.PI * 2) / n)) % n;
    };
    const un = getCurrentWebview().onDragDropEvent(async (e) => {
      const p = e.payload;
      if (p.type === "leave") return setHover(null);
      if (p.type === "enter" || p.type === "over") return setHover(pick(p.position.x, p.position.y));
      const idx = pick(p.position.x, p.position.y);
      setHover(null);
      if (idx === null || busy.current) return;
      busy.current = true;
      await invoke("wheel_busy", { busy: true });
      const format = SLICES[idx];
      try {
        const files = (await invoke<Probe[]>("probe", { paths: p.paths })).filter((f) => f.kind);
        const ok = files.filter((f) => VALID[f.kind!].includes(format));
        if (!ok.length) {
          setStatus("この形式には変換できません");
        } else {
          setStatus("変換中…");
          await invoke("convert", {
            inputs: ok.map((f) => f.path),
            options: {
              format,
              quality: HAS_QUALITY.has(format) ? 80 : null,
              audio_bitrate: null,
              gif_width: null,
              gif_fps: null,
              strip_metadata: false,
            },
          });
          setStatus("完了");
        }
      } catch (err) {
        setStatus("失敗しました");
        console.error(err);
      }
      setTimeout(() => {
        busy.current = false;
        setStatus("");
        void invoke("wheel_hide");
      }, 1100);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const n = SLICES.length;
  return (
    <svg viewBox="0 0 380 380" width="100%" height="100%" role="group" aria-label="変換先の形式" className="select-none">
      <circle cx="190" cy="190" r={R_OUT + 8} fill="oklch(0.98 0.01 80 / 0.55)" />
      {SLICES.map((f, i) => {
        const l = labelPos(i, n);
        const active = hover === i;
        return (
          <g key={f}>
            <path
              d={arc(i, n)}
              fill={active ? "var(--color-accent)" : "oklch(0.99 0.005 80 / 0.85)"}
              style={{ transition: "fill 120ms ease-out" }}
            />
            <text
              x={l.x}
              y={l.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="15"
              fontWeight="600"
              fill={active ? "white" : "var(--color-ink)"}
              style={{ letterSpacing: "0.04em" }}
            >
              {f.toUpperCase()}
            </text>
          </g>
        );
      })}
      <circle cx="190" cy="190" r={R_IN - 6} fill="oklch(0.99 0.005 80 / 0.9)" />
      <text x="190" y="190" textAnchor="middle" dominantBaseline="central" fontSize="13" fill="var(--color-ink)">
        {status || (hover !== null ? SLICES[hover].toUpperCase() : "ドロップ")}
      </text>
    </svg>
  );
}
