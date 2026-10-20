import { useEffect } from "react";

const C = 400;
const RO = 262;
const RI = 138;
const GAP = (5.5 * Math.PI) / 180;
const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(1)} ${(512 + r * Math.sin(a)).toFixed(1)}`;
const SEGS = Array.from({ length: 4 }, (_, i) => {
  const s = -Math.PI / 2 + (i * Math.PI) / 4 + GAP / 2;
  const e = -Math.PI / 2 + ((i + 1) * Math.PI) / 4 - GAP / 2;
  return `M${pt(RO, s)}A${RO} ${RO} 0 0 1 ${pt(RO, e)}L${pt(RI, e)}A${RI} ${RI} 0 0 0 ${pt(RI, s)}Z`;
});

/** 起動時に出る、D のマークが組み上がってワードマークが現れるアニメーション */
export default function Splash() {
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.cssText = "background:transparent;margin:0;overflow:hidden";
  }, []);
  return (
    <svg viewBox="0 0 320 320" width="100%" height="100%" className="block select-none">
      <defs>
        <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="black" floodOpacity="0.45" />
        </filter>
      </defs>
      <style>{`
        @keyframes card { 0% { opacity: 0; transform: translateY(10px) scale(.96) } 16% { opacity: 1; transform: none } 84% { opacity: 1; transform: none } 100% { opacity: 0; transform: translateY(-6px) scale(1.02) } }
        @keyframes bar { from { transform: scaleY(0) } to { transform: scaleY(1) } }
        @keyframes seg { from { opacity: 0; transform: translateX(-14px) } to { opacity: 1; transform: none } }
        @keyframes hot { 0% { opacity: 0; transform: scale(.85) } 100% { opacity: 1; transform: none } }
        @keyframes word { from { opacity: 0; letter-spacing: .5em } to { opacity: 1; letter-spacing: .22em } }
        .card { transform-origin: 160px 160px; animation: card 2.3s cubic-bezier(.25,.9,.3,1) both }
        .bar { transform-box: fill-box; transform-origin: 50% 100%; animation: bar 480ms cubic-bezier(.2,.8,.2,1) 260ms both }
        .seg { animation: seg 380ms cubic-bezier(.2,.8,.2,1) both }
        .hot { transform-box: fill-box; transform-origin: 0% 100%; animation: hot 420ms cubic-bezier(.2,.9,.25,1.15) 900ms both }
        .word { animation: word 700ms cubic-bezier(.2,.8,.2,1) 800ms both }
        text { font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif }
        @media (prefers-reduced-motion: reduce) { .card, .bar, .seg, .hot, .word { animation: none } }
      `}</style>
      <g className="card">
        <rect x="30" y="40" width="260" height="240" rx="34" fill="#1c1b22" stroke="#ffffff" strokeOpacity="0.07" filter="url(#sh)" />
        {/* マーク: 1024 座標のロゴを縮小して配置 */}
        <g transform="translate(160 124) scale(0.27) translate(-491 -512)">
          <rect className="bar" x="290" y="250" width="124" height="524" fill="#f4f0e8" />
          {SEGS.map((d, i) => (
            <path key={i} d={d} className={i === 1 ? "hot" : "seg"} fill={i === 1 ? "#ff6b2c" : "#f4f0e8"} style={{ animationDelay: i === 1 ? undefined : `${520 + i * 90}ms` }} transform="translate(30 0)" />
          ))}
        </g>
        <text className="word" x="160" y="252" textAnchor="middle" fontSize="19" fontWeight="600" fill="#f4f0e8">
          DRACON
        </text>
      </g>
    </svg>
  );
}
