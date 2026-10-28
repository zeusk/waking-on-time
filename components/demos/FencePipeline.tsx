'use client';

// DisplayTask on an indirect (IddCx) display: there is no local vblank interrupt, so the kernel
// emulates vsync, arms a high-resolution timer per flip, and re-phases from driver present statistics.

const W = 1424;
const BAND_H = 126;
const LABEL_W = 200;
const NODE_W = 216;
const NODE_H = 68;
const BANDS = ['User mode', 'OS kernel (Dxgkrnl)', 'IddCx driver (UMDF)', 'Remote device'];
const COLS = 5;

export type NodeId = 'vsync' | 'timer' | 'compositor' | 'flip' | 'driver' | 'tcon' | 'stats';
type Side = 'left' | 'right' | 'top' | 'bottom';
type Pt = { x: number; y: number };

const SPACING = (W - LABEL_W - 10 - NODE_W) / (COLS - 1);
const nx = (col: number) => LABEL_W + 5 + col * SPACING;
const cy = (band: number) => band * BAND_H + BAND_H / 2 + 8;

const NODES: Record<NodeId, { band: number; col: number; title: string; sub: string }> = {
  compositor: { band: 0, col: 2, title: 'VR compositor', sub: 'pose → LSR → DisplayTask' },
  vsync: { band: 1, col: 0, title: 'Vsync emulation', sub: 'predicts remote vblank' },
  timer: { band: 1, col: 1, title: 'High-res timer', sub: 'fires at vblank − offset' },
  flip: { band: 1, col: 3, title: 'Flip queue', sub: 'waits on GPU, then flips' },
  stats: { band: 2, col: 2, title: 'Present statistics', sub: 'made it? dropped? QPC' },
  driver: { band: 2, col: 4, title: 'IddCx swapchain', sub: 'acquire · encode · send' },
  tcon: { band: 3, col: 4, title: 'Remote TCON', sub: 'real vblank + scanout' },
};

function anchor(id: NodeId, side: Side, shift = 0): Pt {
  const n = NODES[id];
  const x = nx(n.col);
  const y = cy(n.band);
  switch (side) {
    case 'left':
      return { x, y: y + shift };
    case 'right':
      return { x: x + NODE_W, y: y + shift };
    case 'top':
      return { x: x + NODE_W / 2 + shift, y: y - NODE_H / 2 };
    case 'bottom':
      return { x: x + NODE_W / 2 + shift, y: y + NODE_H / 2 };
  }
}

const NORMAL: Record<Side, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

type Edge = {
  from: NodeId;
  fromSide: Side;
  to: NodeId;
  toSide: Side;
  shift?: number;
  feedback?: boolean;
  label?: string;
  labelDx?: number;
  labelDy?: number;
};

const EDGES: Edge[] = [
  { from: 'vsync', fromSide: 'right', to: 'timer', toSide: 'left' },
  { from: 'timer', fromSide: 'right', to: 'compositor', toSide: 'left', label: 'fence value + 1', labelDx: -80, labelDy: -44 },
  { from: 'compositor', fromSide: 'right', to: 'flip', toSide: 'left', label: 'TryExecuteTask', labelDx: 72, labelDy: -10 },
  { from: 'flip', fromSide: 'right', to: 'driver', toSide: 'left', label: 'new frame', labelDx: 54, labelDy: -6 },
  { from: 'driver', fromSide: 'bottom', to: 'tcon', toSide: 'top', shift: -50, label: 'frames over USB / Wi-Fi', labelDx: -130, labelDy: 6 },
  { from: 'tcon', fromSide: 'top', to: 'driver', toSide: 'bottom', shift: 50, feedback: true, label: 'timing', labelDx: 34, labelDy: 6 },
  { from: 'driver', fromSide: 'left', to: 'stats', toSide: 'right', feedback: true, label: 'ReportFrameStatistics', labelDy: -12 },
  { from: 'stats', fromSide: 'left', to: 'vsync', toSide: 'bottom', feedback: true, label: 're-phase', labelDx: -40, labelDy: 30 },
];

function geometry(e: Edge) {
  const p0 = anchor(e.from, e.fromSide, e.fromSide === 'top' || e.fromSide === 'bottom' ? e.shift : 0);
  const p3 = anchor(e.to, e.toSide, e.toSide === 'top' || e.toSide === 'bottom' ? e.shift : 0);
  const k = Math.max(30, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 2.6);
  const n0 = NORMAL[e.fromSide];
  const n3 = NORMAL[e.toSide];
  const c1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k };
  const c2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
  const mid = {
    x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
    y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
  };
  return { p0, p3, curve: `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`, mid };
}

const GEO = EDGES.map(geometry);

// The pulse follows the forward path only: timer → compositor → flip → driver → remote panel.
const PULSE_PATH = EDGES.map((e, i) => ({ e, g: GEO[i] }))
  .filter(({ e }) => !e.feedback)
  .reduce((d, { g }, i) => `${d} ${i === 0 ? 'M' : 'L'} ${g.p0.x} ${g.p0.y} ${g.curve}`, '');

export default function FencePipeline({ active }: { active: boolean }) {
  return (
    <svg viewBox={`0 0 ${W} ${BANDS.length * BAND_H + 16}`} className="fp-svg">
      <defs>
        <marker id="fp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="fp-arrowhead" />
        </marker>
        <marker id="fp-arrow-fb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="fp-arrowhead-fb" />
        </marker>
      </defs>

      {BANDS.map((b, i) => (
        <g key={b}>
          <rect x={0} y={i * BAND_H + 8} width={W} height={BAND_H - 6} rx={10} className={`fp-band b${i}`} />
          <text x={16} y={cy(i) + 5} className="fp-band-label">
            {b}
          </text>
        </g>
      ))}

      {EDGES.map((e, i) => (
        <path
          key={i}
          d={`M ${GEO[i].p0.x} ${GEO[i].p0.y} ${GEO[i].curve}`}
          className={e.feedback ? 'fp-edge fp-feedback' : 'fp-edge'}
          markerEnd={e.feedback ? 'url(#fp-arrow-fb)' : 'url(#fp-arrow)'}
        />
      ))}

      {(Object.keys(NODES) as NodeId[]).map((id) => {
        const n = NODES[id];
        const x = nx(n.col);
        const y = cy(n.band);
        return (
          <g key={id} className="fp-node">
            <rect x={x} y={y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={10} />
            <text x={x + 14} y={y - 6} className="fp-title">
              {n.title}
            </text>
            <text x={x + 14} y={y + 20} className="fp-sub">
              {n.sub}
            </text>
          </g>
        );
      })}

      {EDGES.map(
        (e, i) =>
          e.label && (
            <text
              key={i}
              x={GEO[i].mid.x + (e.labelDx ?? 0)}
              y={GEO[i].mid.y + (e.labelDy ?? 0)}
              textAnchor="middle"
              className={e.feedback ? 'fp-edge-label fb' : 'fp-edge-label'}
            >
              {e.label}
            </text>
          ),
      )}

      {active && (
        <circle r={9} className="fp-pulse">
          <animateMotion dur="2.4s" repeatCount="indefinite" path={PULSE_PATH} />
        </circle>
      )}
    </svg>
  );
}
