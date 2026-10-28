'use client';

import { useMemo, useState } from 'react';
import { toPath, type Pt } from '@/lib/geometry';
import type { Graph } from '@/lib/mat';
import { axisDisks, fibreToolpaths, fittingInfill, scanlines } from '@/lib/toolpath';
import { Segmented, Slider } from '../ui';
import { matFor } from './MatStages';

const PW = 680;
const PH = 300;
const FIBRE_WIDTH = 1; // mm, illustrative
const BEAD_MAX = 2; // mm, widest single bead (illustrative)
const INFILL_SPACING = 2.6; // mm between lines of the triangular infill (illustrative)

function frame(bbox: [number, number, number, number]) {
  const [x0, y0, x1, y1] = bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  return { vb: vb.join(' '), px: 1 / Math.min(PW / vb[2], PH / vb[3]) };
}

const regionOf = (outer: Pt[], holes: Pt[][]) => [outer, ...holes].map((r) => toPath(r, true)).join(' ');
const graphPath = (g: Graph) => g.edges.map(([a, b]) => `M${g.nodes[a].p.join(' ')}L${g.nodes[b].p.join(' ')}`).join('');

function FibrePanel() {
  const [shapeId, setShapeId] = useState('channel');
  const [minLength, setMinLength] = useState(30);
  const [minBend, setMinBend] = useState(4);
  const m = matFor(shapeId);
  const res = useMemo(
    () => fibreToolpaths(m.graph, { width: FIBRE_WIDTH, minLength, minBend, distToWall: m.distToBoundary }),
    [m, minLength, minBend],
  );
  const { vb, px } = frame(m.bbox);
  const total = res.strands.reduce((s, x) => s + x.length, 0);

  return (
    <div className="tp-panel">
      <div className="tp-head">
        <h3>Carbon fibre: break the axis, then rebuild it</h3>
        <Segmented
          value={shapeId}
          onChange={setShapeId}
          options={[
            { value: 'channel', label: 'C-channel' },
            { value: 'bracket', label: 'Bracket' },
          ]}
        />
      </div>
      <svg viewBox={vb} width={PW} height={PH} className="tp-svg">
        <path d={regionOf(m.shape.outer, m.shape.holes)} fillRule="evenodd" className="ms-region ms-wall" />
        <path d={graphPath(m.graph)} className="tp-axis" />
        {res.thin.map((l, i) => (
          <polyline key={`t${i}`} points={l.map((p) => p.join(',')).join(' ')} className="tp-thin" />
        ))}
        {res.short.map((l, i) => (
          <polyline key={`s${i}`} points={l.map((p) => p.join(',')).join(' ')} className="tp-short" />
        ))}
        {res.strands.map((s, i) => (
          <path key={i} d={s.d} className="tp-strand" strokeWidth={FIBRE_WIDTH} />
        ))}
        {res.cuts.map((p, i) => (
          <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={2.6 * px} className="tp-cut" />
        ))}
        {res.bendBreaks.map((p, i) => (
          <circle key={`b${i}`} cx={p[0]} cy={p[1]} r={5 * px} className="tp-break" />
        ))}
      </svg>
      <div className="controls tp-controls">
        <Slider label="Minimum strand length" value={minLength} min={5} max={90} format={(v) => `${v} mm`} onChange={setMinLength} />
        <Slider label="Tightest bend radius" value={minBend} min={0.5} max={15} step={0.5} format={(v) => `${v} mm`} onChange={setMinBend} />
      </div>
      <div className="tp-legend">
        <span className="lg strand">fibre strand · {res.strands.length}</span>
        <span className="lg short">too short · {res.short.length}</span>
        <span className="lg brk">bend too tight · {res.bendBreaks.length}</span>
        {res.thin.length > 0 && <span className="lg thin">narrower than a fibre</span>}
        <span className="lg total">{total.toFixed(0)} mm laid</span>
      </div>
    </div>
  );
}

function GapPanel() {
  const [minWidth, setMinWidth] = useState(3);
  const [bead, setBead] = useState(true);
  const m = matFor('rib');
  const { vb } = frame(m.bbox);

  const disks = useMemo(() => axisDisks(m.graph, m.distToBoundary, 0.35), [m]);
  // Triangular infill, as on the slicer slide: three line families at 60° through one shared point.
  const lines = useMemo(() => [0, 60, 120].flatMap((a) => scanlines(m.shape, a, INFILL_SPACING, [30, 30])), [m]);
  const thinDisks = useMemo(() => disks.filter((k) => 2 * k.r < minWidth), [disks, minWidth]);
  const infill = useMemo(() => fittingInfill(lines, thinDisks), [lines, thinDisks]);
  const residual = bead && thinDisks.some((k) => 2 * k.r > BEAD_MAX);

  return (
    <div className="tp-panel">
      <div className="tp-head">
        <h3>Thin regions: one bead along the axis</h3>
        <Segmented
          value={bead}
          onChange={setBead}
          options={[
            { value: false, label: 'Infill only' },
            { value: true, label: '+ axis bead' },
          ]}
        />
      </div>
      <svg viewBox={vb} width={PW} height={PH} className="tp-svg">
        <path d={regionOf(m.shape.outer, m.shape.holes)} fillRule="evenodd" className="ms-region" />
        <path d={infill.map(([a, b]) => `M${a.join(' ')}L${b.join(' ')}`).join('')} className="tp-infill" />
        {thinDisks.map((k, i) => (
          <circle key={`g${i}`} cx={k.c[0]} cy={k.c[1]} r={k.r} className="tp-gap" />
        ))}
        {bead &&
          thinDisks.map((k, i) => <circle key={`b${i}`} cx={k.c[0]} cy={k.c[1]} r={Math.min(k.r, BEAD_MAX / 2)} className="tp-bead" />)}
        <path d={graphPath(m.graph)} className="tp-axis" style={{ strokeWidth: 1 }} />
        <path d={regionOf(m.shape.outer, m.shape.holes)} fillRule="evenodd" className="ms-wall" />
      </svg>
      <div className="controls tp-controls">
        <Slider
          label="Infill pattern needs at least"
          value={minWidth}
          min={1.5}
          max={7}
          step={0.1}
          format={(v) => `${v.toFixed(1)} mm`}
          onChange={setMinWidth}
        />
      </div>
      <div className="tp-legend">
        <span className="lg infill">infill pattern</span>
        <span className="lg gap">{bead ? 'slight gap left' : 'gap: pattern does not fit'}</span>
        {bead && <span className="lg bead">plastic bead, no fibre (≤ {BEAD_MAX} mm wide)</span>}
        {bead && !residual && <span className="lg total">fully covered</span>}
      </div>
      <p className="tp-caption">Region left inside the walls of a rib: 14 mm wide at the root, 1.2 mm at the tip.</p>
    </div>
  );
}

export default function MatToolpaths() {
  return (
    <div className="toolpaths">
      <FibrePanel />
      <GapPanel />
    </div>
  );
}
