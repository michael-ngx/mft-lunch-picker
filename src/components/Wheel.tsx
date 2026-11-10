// The wheel: one slice per contender, a pointer at the top. The parent sets the
// rotation; the CSS transition does the spinning and slowing down.
import { segmentColors, wheelLabel } from "../lib/wheel.ts";
import type { Suggestion } from "../lib/lunch.ts";

const R = 240;

function slice(i: number, n: number) {
  const a = (2 * Math.PI) / n;
  const a0 = i * a - Math.PI / 2;
  const a1 = a0 + a;
  const x0 = R * Math.cos(a0), y0 = R * Math.sin(a0);
  const x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}

export function Wheel({ items, rotation, durationMs, spinning, onStop }: {
  items: Suggestion[]; rotation: number; durationMs: number; spinning: boolean; onStop: () => void;
}) {
  const n = items.length;
  const colors = segmentColors(n);
  const fontSize = n <= 4 ? 17 : n <= 8 ? 15 : n <= 12 ? 13 : 11;
  return (
    <div className={`wheel${spinning ? " spinning" : ""}`}>
      <svg className="wheel-pointer" viewBox="0 0 40 48" aria-hidden="true"><path d="M20 46 L3 6 Q20 -4 37 6 Z" /></svg>
      <div className="wheel-disc" style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${durationMs}ms` }}
        onTransitionEnd={(e) => { if (e.propertyName === "transform") onStop(); }}>
        <svg viewBox="-250 -250 500 500" role="img" aria-label={`Wheel with ${n} contenders: ${items.map((s) => s.name).join(", ")}`}>
          <circle r="248" className="wheel-rim" />
          {items.map((s, i) => {
            const mid = (i + 0.5) * (360 / n) - 90;
            const flip = mid > 90 && mid < 270;
            return (
              <g key={s.id}>
                <path d={slice(i, n)} fill={colors[i].fill} stroke="#ffffff" strokeWidth="2" />
                <text transform={`rotate(${mid}) translate(${R * 0.6} 0)${flip ? " rotate(180)" : ""}`} fill={colors[i].text}
                  fontSize={fontSize} fontWeight="700" textAnchor="middle" dominantBaseline="middle">{wheelLabel(s.name, n)}</text>
              </g>
            );
          })}
          <circle r="34" className="wheel-hub" />
          <circle r="12" className="wheel-hub-dot" />
        </svg>
      </div>
    </div>
  );
}

/** The picture on the game card. */
export function WheelArt() {
  const n = 8;
  const colors = segmentColors(n);
  return (
    <svg viewBox="-260 -260 520 520" aria-hidden="true" className="game-art-wheel">
      <circle r="252" fill="#ffffff" opacity="0.9" />
      <g transform="rotate(-12)">
        {Array.from({ length: n }, (_, i) => <path key={i} d={slice(i, n)} fill={colors[i].fill} stroke="#ffffff" strokeWidth="3" />)}
      </g>
      <circle r="36" fill="#ffffff" />
      <circle r="13" fill="#ef4444" />
      <path d="M0 -268 L-20 -222 L20 -222 Z" fill="#ef4444" stroke="#ffffff" strokeWidth="4" />
    </svg>
  );
}
