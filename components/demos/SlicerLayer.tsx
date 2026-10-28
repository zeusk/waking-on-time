// One sliced layer of a plate with two bolt holes, showing each kind of toolpath a slicer generates.
import type { Pt } from '@/lib/geometry';

const W = 150;
const H = 72;
const HOLES: [number, number][] = [
  [38, 36],
  [112, 36],
];
const R = 10;

/** Lattice lines clipped to the plate inset by `inset`, minus the holes grown by `inset`. */
function lattice(inset: number, spacing: number, angles: number[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const [x0, y0, x1, y1] = [inset, inset, W - inset, H - inset];
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const u: Pt = [Math.cos(a), Math.sin(a)];
    const n: Pt = [-u[1], u[0]];
    const reach = Math.hypot(W, H);
    for (let s = -reach; s <= reach; s += spacing) {
      const o: Pt = [W / 2 + n[0] * s, H / 2 + n[1] * s];
      // Liang–Barsky against the inset rectangle.
      let t0 = -reach;
      let t1 = reach;
      const clip = (p: number, q: number) => {
        if (Math.abs(p) < 1e-12) return q >= 0;
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        return true;
      };
      if (!(clip(-u[0], o[0] - x0) && clip(u[0], x1 - o[0]) && clip(-u[1], o[1] - y0) && clip(u[1], y1 - o[1]))) continue;
      if (t0 >= t1) continue;
      let spans: [number, number][] = [[t0, t1]];
      for (const [cx, cy] of HOLES) {
        const rr = R + inset;
        const tc = (cx - o[0]) * u[0] + (cy - o[1]) * u[1];
        const d2 = (o[0] + u[0] * tc - cx) ** 2 + (o[1] + u[1] * tc - cy) ** 2;
        if (d2 >= rr * rr) continue;
        const h = Math.sqrt(rr * rr - d2);
        spans = spans.flatMap(([a, b]): [number, number][] =>
          [
            [a, Math.min(b, tc - h)],
            [Math.max(a, tc + h), b],
          ].filter(([p, q]) => q - p > 0.5) as [number, number][],
        );
      }
      for (const [a, b] of spans) out.push([[o[0] + u[0] * a, o[1] + u[1] * a], [o[0] + u[0] * b, o[1] + u[1] * b]]);
    }
  }
  return out;
}

const INFILL = lattice(8, 8, [0, 60, 120]);
const SUPPORT = Array.from({ length: 10 }, (_, i) => 160 + 1.5 + i * 3.8);
const line = ([a, b]: [Pt, Pt]) => `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;

export const LAYER_COLORS = {
  wall: '#9fb3cc',
  infill: '#5f6f84',
  fibre: '#f4a259',
  support: '#6fa98a',
  skin: '#c792ea',
};

export default function SlicerLayer() {
  return (
    <svg viewBox="-4 -4 206 82" className="slicer-svg">
      <path
        d={`M0 0H${W}V${H}H0Z ${HOLES.map(([x, y]) => `M${x + R} ${y}a${R} ${R} 0 1 0 ${-2 * R} 0a${R} ${R} 0 1 0 ${2 * R} 0`).join(' ')}`}
        className="sl-part"
        fillRule="evenodd"
      />
      <path d={INFILL.map(line).join('')} stroke={LAYER_COLORS.infill} strokeWidth={0.55} fill="none" />
      {[4.8, 6.4].map((d) => (
        <g key={d} stroke={LAYER_COLORS.fibre} strokeWidth={1} fill="none">
          <rect x={d} y={d} width={W - 2 * d} height={H - 2 * d} rx={d - 2.5} />
          {HOLES.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={R + d} />
          ))}
        </g>
      ))}
      {[0.8, 2.4].map((d) => (
        <g key={d} stroke={LAYER_COLORS.wall} strokeWidth={1.5} fill="none">
          <rect x={d} y={d} width={W - 2 * d} height={H - 2 * d} />
          {HOLES.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={R + d} />
          ))}
        </g>
      ))}
      <rect x={160} y={20} width={38} height={52} className="sl-support-box" />
      <path
        d={SUPPORT.map((x) => `M${x} 22V70`).join('') + 'M161.5 22H196.5M161.5 70H196.5'}
        stroke={LAYER_COLORS.support}
        strokeWidth={0.7}
        fill="none"
      />
      <text x={179} y={11} textAnchor="middle" className="sl-label">
        support under
      </text>
      <text x={179} y={16} textAnchor="middle" className="sl-label">
        an overhang
      </text>
    </svg>
  );
}
