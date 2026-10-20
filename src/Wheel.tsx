import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings } from "@/lib/settings";
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
const AUDIO_OUT = new Set(["mp3", "opus", "m4a", "ogg", "aac", "ac3", "wma", "mp2"]);

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

// 設定から受け取る配置（表示のたびに更新）
let ROT = 0; // rad
let SCALE = 1;
const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;

function wedge(i: number, n: number) {
  const step = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 + ROT - step / 2 + i * step + GAP;
  const a1 = a0 + step - GAP * 2;
  return `M ${pt(R_IN, a0)} L ${pt(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1)} L ${pt(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0)} Z`;
}

function mid(i: number, n: number, r: number) {
  const a = -Math.PI / 2 + ROT + (i * Math.PI * 2) / n;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a) };
}

/** 中心からのずれ(CSS px)→ 楔の番号（中央=CENTER、外側=null） */
function pickRel(dx: number, dy: number, slices: number) {
  dx /= SCALE;
  dy /= SCALE;
  const r = Math.hypot(dx, dy);
  if (r <= R_IN) return CENTER;
  if (r > R_OUT + 6) return null;
  const m = slices;
  const a = (Math.atan2(dy, dx) + Math.PI / 2 - ROT + Math.PI / m + Math.PI * 8) % (Math.PI * 2);
  return Math.floor(a / ((Math.PI * 2) / m)) % m;
}

export default function Wheel() {
  const [files, setFiles] = useState<Probe[]>([]);
  const [hover, setHoverState] = useState<number | null>(CENTER);
  const setHover = (v: number | null) => {
    hoverRef.current = v;
    setHoverState(v);
  };
  const [status, setStatus] = useState("");
  const [shown, setShown] = useState(0);
  const [closing, setClosing] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const busy = useRef(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const kindRef = useRef("image");
  const hoverRef = useRef<number | null>(CENTER);
  const hookMoved = useRef(false);

  const first = files.find((f) => f.kind);
  const kind = first?.kind ?? "image";
  kindRef.current = kind;
  const [cfg, setCfg] = useState<Settings | null>(null);
  const cfgRef = useRef<Settings | null>(null);
  cfgRef.current = cfg;
  const slicesFor = (k: string) => {
    const c = cfgRef.current;
    const l = c ? (k === "audio" ? c.wheel_audio : k === "video" ? c.wheel_video : c.wheel_image) : SETS[k];
    return l && l.length >= 2 ? l : SETS[k] ?? SETS.image;
  };
  ROT = ((cfg?.wheel_rotation ?? 0) * Math.PI) / 180;
  SCALE = cfg?.wheel_scale ?? 1;
  const slices = slicesFor(kind);
  const n = slices.length;
  const total = files.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    const root = document.documentElement;
    root.style.background = "transparent";
    root.style.overflow = "hidden";
    document.body.style.cssText = "background:transparent;margin:0;overflow:hidden";
  }, []);

  useEffect(() => {
    const b = listen("wheel-hide", () => setClosing(true));
    const m = listen<[number, number]>("wheel-move", (e) => {
      hookMoved.current = true;
      const dpr = window.devicePixelRatio || 1;
      setHover(pickRel(e.payload[0] / dpr, e.payload[1] / dpr, slicesFor(kindRef.current).length));
    });
    const a = listen("wheel-show", () => {
      hookMoved.current = false;
      setClosing(false);
      busy.current = false;
      setFiles([]);
      setHover(CENTER);
      setStatus("");
      setThumbOk(true);
      void invoke<Settings>("get_settings").then(setCfg);
      setShown((k) => k + 1);
    });
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
      void m.then((f) => f());
    };
  }, []);

  useEffect(() => {
    void invoke("wheel_log", { msg: "wheel mounted" });
    window.addEventListener("error", (ev) => void invoke("wheel_log", { msg: `error ${ev.message}` }));
  }, []);

  useEffect(() => {
    const pick = (x: number, y: number) => {
      const dpr = window.devicePixelRatio || 1;
      return pickRel(x / dpr - C, y / dpr - C, slicesFor(kindRef.current).length);
    };
    const un = getCurrentWebview().onDragDropEvent(async (e) => {
      const p = e.payload;
      if (p.type !== "over") void invoke("wheel_log", { msg: `${p.type} ${JSON.stringify(p)}` });
      if (busy.current) return;
      if (p.type === "leave") {
        // ホイールから離れたらキャンセル
        setHover(null);
        leaveTimer.current = window.setTimeout(() => void invoke("wheel_hide"), 120);
        return;
      }
      window.clearTimeout(leaveTimer.current);
      if (p.type === "enter") {
        const probed = await invoke<Probe[]>("probe", { paths: p.paths, wheel: true });
        if (probed.length > 0 && probed.every((f) => !f.kind)) {
          // 変換できないファイル（.exe など）ではホイールを出さない
          void invoke("wheel_reject");
          return;
        }
        setFiles(probed);
        return hookMoved.current ? undefined : setHover(pick(p.position.x, p.position.y));
      }
      if (p.type === "over") return hookMoved.current ? undefined : setHover(pick(p.position.x, p.position.y));

      // drop
      const idx = hookMoved.current ? hoverRef.current : pick(p.position.x, p.position.y);
      setHover(null);
      if (idx === null || idx === CENTER) return void invoke("wheel_hide"); // 外側・中央はキャンセル
      busy.current = true;
      await invoke("wheel_busy", { busy: true });
      const format = slicesFor(kindRef.current)[idx];
      try {
        const probed = (await invoke<Probe[]>("probe", { paths: p.paths, wheel: true })).filter((f) => f.kind);
        const ok = probed;
        setStatus("変換中…");
        const cfg = await invoke<{ quality: number; audio_bitrate: number; strip_metadata: boolean }>("get_settings");
        await invoke("convert", {
          inputs: ok.map((f) => f.path),
          options: {
            format,
            quality: HAS_QUALITY.has(format) ? cfg.quality : null,
            audio_bitrate: AUDIO_OUT.has(format) ? cfg.audio_bitrate : null,
            gif_width: null,
            gif_fps: null,
            strip_metadata: cfg.strip_metadata,
          },
          notify: true,
        });
        setStatus("完了");
      } catch (err) {
        setStatus("失敗");
        console.error(err);
      }
      window.setTimeout(() => void invoke("wheel_hide"), 500);
    });
    return () => void un.then((f) => f());
  }, []);

  const thumb = first && THUMB.test(first.name) && thumbOk && (cfg?.wheel_thumb ?? true) ? convertFileSrc(first.path) : null;
  const ready = files.length > 0;
  const label = status || (!ready ? "" : hover === CENTER ? "キャンセル" : hover !== null && hover >= 0 ? slices[hover].toUpperCase() : "");

  const sub = label && files.length ? fmtSize(total) : files.length > 1 ? `${files.length} 件` : "";
  return (
    <svg viewBox="0 0 420 420" width="100%" height="100%" className="block select-none" role="group" aria-label="変換先の形式を選ぶ">
      <defs>
        <radialGradient id="frost" cx={C} cy={C} r={R_OUT} gradientUnits="userSpaceOnUse">
          <stop offset="0.35" stopColor="white" stopOpacity="0.55" />
          <stop offset="1" stopColor="white" stopOpacity="0.8" />
        </radialGradient>
        <radialGradient id="hot" cx={C} cy={C} r={R_OUT} gradientUnits="userSpaceOnUse">
          <stop offset="0.3" stopColor="oklch(0.78 0.16 62)" stopOpacity="0.92" />
          <stop offset="1" stopColor="oklch(0.66 0.19 48)" stopOpacity="0.98" />
        </radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.12" />
          <stop offset="1" stopColor="white" stopOpacity="0.4" />
        </linearGradient>
        <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="12" floodColor="black" floodOpacity="0.28" />
        </filter>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="oklch(0.75 0.17 55)" floodOpacity="0.75" />
        </filter>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="black" floodOpacity="0.45" />
        </filter>
        <clipPath id="th">
          <circle cx={C} cy={C - 16} r="27" />
        </clipPath>
      </defs>
      <style>{`
        @keyframes wheel-in { from { opacity: 0; transform: scale(.82) rotate(-8deg) } to { opacity: 1; transform: scale(1) rotate(0) } }
        @keyframes wheel-out { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(.9) } }
        @keyframes wedge-in { from { opacity: 0; transform: scale(.7) } to { opacity: 1; transform: scale(1) } }
        .wheel-root { transform-origin: 210px 210px; animation: wheel-in 260ms cubic-bezier(.2,.9,.25,1.1) both }
        .wheel-root.closing { animation: wheel-out 170ms cubic-bezier(.4,0,1,1) forwards }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fade-in { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: scale(1) } }
        .spin { transform-origin: 210px 194px; animation: spin 900ms linear infinite }
        .fade-in { transform-origin: 210px 194px; animation: fade-in 220ms cubic-bezier(.2,.9,.25,1.2) both }
        .ctext { animation: fade-in 220ms ease-out both; transform-origin: 210px 210px }
        .wedge-pop { transform-origin: 210px 210px; animation: wedge-in 300ms cubic-bezier(.2,.9,.25,1.2) both; animation-delay: calc(var(--i) * 28ms + 40ms) }
        .wedge { transition: fill 120ms ease-out, transform 160ms cubic-bezier(.2,.9,.25,1.2), filter 160ms ease-out }
        .lab { transition: font-size 120ms ease-out }
        text { font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums }
        @media (prefers-reduced-motion: reduce) { .wheel-root, .wedge-pop, .spin, .fade-in, .ctext { animation: none } .wedge, .lab { transition: none } }
      `}</style>
      <g key={`${shown}-${files.length > 0}`} style={{ visibility: shown === 0 || files.length === 0 ? "hidden" : "visible" }} className={closing ? "wheel-root closing" : "wheel-root"}>
      <g transform={`translate(${C} ${C}) scale(${SCALE}) translate(${-C} ${-C})`}>
        {/* 面：暗めの色味でぼかした背景の上に重ねる */}
        <circle cx={C} cy={C} r={R_OUT + 6} fill="oklch(0.97 0.01 80 / 0.5)" filter="url(#drop)" />
        <circle cx={C} cy={C} r={R_OUT + 6} fill="none" stroke="url(#rim)" strokeWidth="1.5" />
        {slices.map((f, i) => {
          const active = hover === i;
          const m = mid(i, n, (R_IN + R_OUT) / 2);
          const off = active ? 6 : 0;
          return (
            <g key={f} className="wedge-pop" style={{ "--i": i } as React.CSSProperties}>
            <g className="wedge" style={{ transform: `translate(${m.dx * off}px, ${m.dy * off}px)` }}>
              <path
                d={wedge(i, n)}
                className="wedge"
                fill={active ? "url(#hot)" : "url(#frost)"}
                stroke={active ? "oklch(1 0 0 / 0.55)" : "oklch(1 0 0 / 0.22)"}
                strokeWidth="1"
                filter={active ? "url(#glow)" : undefined}
              />
              {(cfg?.wheel_labels ?? true) && <text
                x={m.x}
                y={m.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={active ? 17 : 15}
                className="lab"
                fontWeight="650"
                letterSpacing="0.06em"
                fill={active ? "white" : "oklch(0.3 0.02 55)"}
              >
                {f.toUpperCase()}
              </text>}
            </g>
            </g>
          );
        })}
        <circle
          cx={C}
          cy={C}
          r={R_IN - 8}
          fill={ready && hover === CENTER ? "oklch(0.6 0.2 25 / 0.9)" : "oklch(0.3 0.02 55 / 0.7)"}
          className="wedge"
        />
        <circle cx={C} cy={C} r={R_IN - 8} fill="none" stroke="url(#rim)" strokeWidth="1.5" />
        {thumb ? (
          <g filter="url(#soft)" className="fade-in">
            <image href={thumb} x={C - 27} y={C - 43} width="54" height="54" preserveAspectRatio="xMidYMid slice" clipPath="url(#th)" onError={() => setThumbOk(false)} />
            <circle cx={C} cy={C - 16} r="27" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="2" />
          </g>
        ) : (
          <g filter="url(#soft)" stroke="white" strokeOpacity="0.85" strokeWidth="2" fill="none" strokeLinecap="round">
            <circle cx={C} cy={C - 16} r="27" />
            <circle className="spin" cx={C} cy={C - 16} r="27" strokeDasharray="34 140" strokeOpacity="1" />
          </g>
        )}
        <text key={label} className="ctext" x={C} y={C + 26} textAnchor="middle" fontSize="16" fontWeight="650" fill="white" filter="url(#soft)">
          {label || (files.length ? fmtSize(total) : "ドロップ")}
        </text>
        <text x={C} y={C + 44} textAnchor="middle" fontSize="11.5" fill="white" fillOpacity="0.8" filter="url(#soft)">
          {sub}
        </text>
        <text x={C} y="410" textAnchor="middle" fontSize="11" fill="oklch(0.25 0.02 55)" fillOpacity="0.85">
          中央・外側で離すとキャンセル / Esc
        </text>
      </g>
      </g>
    </svg>
  );
}
