import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type Probe = { path: string; name: string; kind: string | null; size: number };

const SETS: Record<string, string[]> = {
  image: ["jpg", "png", "webp", "avif", "tiff", "bmp", "gif", "ico"],
  audio: ["mp3", "wav", "flac", "opus", "m4a", "ogg", "aac", "aiff"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "gif", "mp3", "wav"],
};
const HAS_QUALITY = new Set(["jpg", "webp", "avif", "mp4", "webm", "mov", "mkv", "avi"]);
const THUMB = /\.(png|jpe?g|webp|gif|bmp|avif|ico)$/i;

const C = 210; // 窓の中心（論理px）
const R_OUT = 182;
const R_IN = 78;
const GAP = 0.022;
const CENTER = -1;

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;

function wedge(i: number, n: number) {
  const step = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 - step / 2 + i * step + GAP;
  const a1 = a0 + step - GAP * 2;
  return `M ${pt(R_IN, a0)} L ${pt(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1)} L ${pt(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0)} Z`;
}

function mid(i: number, n: number, r: number) {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a) };
}

export default function Wheel() {
  const [files, setFiles] = useState<Probe[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [shown, setShown] = useState(0);
  const [thumbOk, setThumbOk] = useState(true);
  const busy = useRef(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const kindRef = useRef("image");

  const first = files.find((f) => f.kind);
  const kind = first?.kind ?? "image";
  kindRef.current = kind;
  const slices = SETS[kind] ?? SETS.image;
  const n = slices.length;
  const total = files.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    const root = document.documentElement;
    root.style.background = "transparent";
    root.style.overflow = "hidden";
    document.body.style.cssText = "background:transparent;margin:0;overflow:hidden";
  }, []);

  useEffect(() => {
    const a = listen("wheel-show", () => {
      busy.current = false;
      setFiles([]);
      setHover(null);
      setStatus("");
      setThumbOk(true);
      setShown((k) => k + 1);
    });
    return () => void a.then((f) => f());
  }, []);

  useEffect(() => {
    const pick = (x: number, y: number) => {
      const dpr = window.devicePixelRatio || 1;
      const dx = x / dpr - C;
      const dy = y / dpr - C;
      const r = Math.hypot(dx, dy);
      if (r <= R_IN) return CENTER;
      if (r > R_OUT + 6) return null;
      const m = (SETS[kindRef.current] ?? SETS.image).length;
      const a = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / m + Math.PI * 4) % (Math.PI * 2);
      return Math.floor(a / ((Math.PI * 2) / m)) % m;
    };
    const un = getCurrentWebview().onDragDropEvent(async (e) => {
      const p = e.payload;
      if (busy.current) return;
      if (p.type === "leave") {
        // ホイールから離れたらキャンセル
        setHover(null);
        leaveTimer.current = window.setTimeout(() => void invoke("wheel_hide"), 350);
        return;
      }
      window.clearTimeout(leaveTimer.current);
      if (p.type === "enter") {
        const probed = await invoke<Probe[]>("probe", { paths: p.paths });
        setFiles(probed);
        return setHover(pick(p.position.x, p.position.y));
      }
      if (p.type === "over") return setHover(pick(p.position.x, p.position.y));

      // drop
      const idx = pick(p.position.x, p.position.y);
      setHover(null);
      if (idx === null || idx === CENTER) return void invoke("wheel_hide"); // 外側・中央はキャンセル
      busy.current = true;
      await invoke("wheel_busy", { busy: true });
      const format = (SETS[kindRef.current] ?? SETS.image)[idx];
      try {
        const probed = (await invoke<Probe[]>("probe", { paths: p.paths })).filter((f) => f.kind);
        const ok = probed;
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
      } catch (err) {
        setStatus("失敗");
        console.error(err);
      }
      window.setTimeout(() => void invoke("wheel_hide"), 900);
    });
    return () => void un.then((f) => f());
  }, []);

  const thumb = first && THUMB.test(first.name) && thumbOk ? convertFileSrc(first.path) : null;
  const label = status || (hover === CENTER ? "キャンセル" : hover !== null && hover >= 0 ? slices[hover].toUpperCase() : "");

  return (
    <svg viewBox="0 0 420 420" width="100%" height="100%" className="block select-none" role="group" aria-label="変換先の形式を選ぶ">
      <style>{`
        @keyframes wheel-in { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: scale(1) } }
        .wheel-root { transform-origin: 210px 210px; animation: wheel-in 160ms cubic-bezier(.2,.8,.2,1) both }
        .wedge { transition: fill 110ms ease-out, transform 140ms cubic-bezier(.2,.8,.2,1) }
        @media (prefers-reduced-motion: reduce) { .wheel-root { animation: none } .wedge { transition: none } }
      `}</style>
      <g key={shown} className="wheel-root">
        <circle cx={C} cy={C} r={R_OUT + 6} fill="oklch(0.2 0.012 55 / 0.9)" stroke="oklch(1 0 0 / 0.12)" strokeWidth="1" />
        {slices.map((f, i) => {
          const active = hover === i;
          const m = mid(i, n, (R_IN + R_OUT) / 2);
          const off = active ? 5 : 0;
          return (
            <g key={f} className="wedge" style={{ transform: `translate(${m.dx * off}px, ${m.dy * off}px)` }}>
              <path
                d={wedge(i, n)}
                className="wedge"
                fill={active ? "var(--color-accent)" : "oklch(0.3 0.012 55 / 0.9)"}
              />
              <text
                x={m.x}
                y={m.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="15"
                fontWeight="600"
                letterSpacing="0.05em"
                fill={active ? "oklch(0.2 0.02 55)" : "oklch(0.95 0.005 80)"}
              >
                {f.toUpperCase()}
              </text>
            </g>
          );
        })}
        <circle
          cx={C}
          cy={C}
          r={R_IN - 7}
          fill={hover === CENTER ? "oklch(0.4 0.06 25)" : "oklch(0.15 0.01 55)"}
          stroke="oklch(1 0 0 / 0.1)"
          className="wedge"
        />
        {thumb ? (
          <>
            <clipPath id="th">
              <circle cx={C} cy={C - 14} r="24" />
            </clipPath>
            <image href={thumb} x={C - 24} y={C - 38} width="48" height="48" preserveAspectRatio="xMidYMid slice" clipPath="url(#th)" onError={() => setThumbOk(false)} />
          </>
        ) : null}
        <text x={C} y={thumb ? C + 28 : C - 6} textAnchor="middle" fontSize="15" fontWeight="600" fill="oklch(0.97 0.005 80)">
          {label || (files.length ? fmtSize(total) : "ドロップ")}
        </text>
        <text x={C} y={thumb ? C + 46 : C + 14} textAnchor="middle" fontSize="11" fill="oklch(0.75 0.01 70)">
          {label && files.length ? fmtSize(total) : files.length > 1 ? `${files.length} 件` : ""}
        </text>
        <text x={C} y="412" textAnchor="middle" fontSize="11" fill="oklch(0.85 0.01 70)" stroke="oklch(0.1 0 0 / 0.6)" strokeWidth="3" paintOrder="stroke">
          中央・外側にドロップ / Esc でキャンセル
        </text>
      </g>
    </svg>
  );
}
