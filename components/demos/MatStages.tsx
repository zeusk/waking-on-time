'use client';

import { useEffect, useMemo, useState } from 'react';
import { toPath, type Pt } from '@/lib/geometry';
import { medialAxis, type MatResult, type Mesh, type TriType } from '@/lib/mat';
import { SHAPES, shapeById } from '@/lib/shapes';
import { Segmented } from '../ui';

const cache = new Map<string, MatResult>();
export function matFor(id: string) {
  if (!cache.has(id)) cache.set(id, medialAxis(shapeById(id)));
  return cache.get(id)!;
}

const STAGES = [
  {
    title: 'Layer polygon',
    text: 'One region of one layer: an outer loop plus any holes, exactly as the slicer clipped it.',
  },
  {
    title: 'Constrained Delaunay triangulation',
    text: "Triangulate with only the polygon's own vertices, keeping every polygon edge. Delaunay circumcentres sit on the Voronoi diagram, so they are candidate axis points.",
  },
  {
    title: '§2.1 Fix obtuse junction triangles',
    text: 'A triangle with no polygon edge and an obtuse angle has its circumcentre outside it. Cast a ray from the obtuse corner to that centre. If it leaves the polygon, add a Steiner point on the edge it hits and re-triangulate.',
  },
  {
    title: '§2.2 Fix convex corners',
    text: 'The axis always reaches convex corners. At each one, take half the distance to the nearest vertex, add a Steiner point on both corner edges, and seat a small isosceles ear in the corner.',
  },
  {
    title: '§2.3 Classify triangles',
    text: 'Type A has one polygon edge (the axis passes through), type B has two (the axis ends at its corner), type C has none (the axis branches).',
  },
  {
    title: 'Build the axis',
    text: "Walk from C to C, joining circumcentres through the midpoints of A triangles' exit edges, and run straight from the last C into each B corner. A triangles pierced by an obtuse C's circumcentre are skipped.",
  },
  {
    title: 'Drop the segments that reach the wall',
    text: 'Our change for the slicer: the last segment of every branch runs into a convex corner on the wall. A fibre laid along it would come out through the surface, so it is removed and the axis stops at the junction.',
  },
];

const LAST = STAGES.length - 1;
const STEP_MS = 500;
const W = 900;
const H = 470;
const TYPE_CLASS: Record<TriType, string> = { A: 'tri-a', B: 'tri-b', C: 'tri-c' };

function edgesPath(mesh: Mesh) {
  const walls = new Set(mesh.segs.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)));
  const seen = new Set<string>();
  let d = '';
  for (const t of mesh.tris)
    for (let i = 0; i < 3; i++) {
      const a = t[i];
      const b = t[(i + 1) % 3];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(k) || walls.has(k)) continue;
      seen.add(k);
      d += `M${mesh.points[a][0]} ${mesh.points[a][1]}L${mesh.points[b][0]} ${mesh.points[b][1]}`;
    }
  return d;
}

const triPoints = (mesh: Mesh, t: number[]) => t.map((i) => mesh.points[i].join(',')).join(' ');
const linePoints = (l: Pt[]) => l.map((p) => p.join(',')).join(' ');

export default function MatStages({ active }: { active: boolean }) {
  const [shapeId, setShapeId] = useState('bracket');
  const [stage, setStage] = useState(active ? 0 : LAST);
  const [playing, setPlaying] = useState(active);
  const m = useMemo(() => matFor(shapeId), [shapeId]);

  // Play through every step whenever the slide comes on screen, then hold the last one.
  useEffect(() => {
    if (!active) return;
    setStage(0);
    setPlaying(true);
  }, [active]);

  useEffect(() => {
    if (!active || !playing) return;
    if (stage >= LAST) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStage((s) => Math.min(LAST, s + 1)), STEP_MS);
    return () => clearTimeout(id);
  }, [active, playing, stage]);

  const show = (i: number) => {
    setStage(i);
    setPlaying(false);
  };
  const replay = (id = shapeId) => {
    setShapeId(id);
    setStage(0);
    setPlaying(true);
  };
  const toggle = () => {
    if (playing) setPlaying(false);
    else if (stage >= LAST) replay();
    else setPlaying(true);
  };

  const [x0, y0, x1, y1] = m.bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  const px = 1 / Math.min(W / vb[2], H / vb[3]); // user units per screen pixel
  const region = [m.shape.outer, ...m.shape.holes].map((r) => toPath(r, true)).join(' ');
  const counts = { A: 0, B: 0, C: 0 } as Record<TriType, number>;
  m.types.forEach((t) => counts[t]++);
  const added21 = m.obtuse.mesh.points.length - m.cdt.points.length + m.recheck.length;
  const disabled = new Set(m.axis.disabled);

  // Points can coincide (corners share Steiner points, the cross has repeated circumcentres), so key by position in the list.
  const dots = (ps: Pt[], cls: string, r = 3.2) =>
    ps.map((p, i) => <circle key={`${cls}${i}`} cx={p[0]} cy={p[1]} r={r * px} className={cls} />);

  return (
    <div className="mat-stages">
      <div className="ms-left">
        <svg viewBox={vb.join(' ')} width={W} height={H} className="ms-svg">
          <path d={region} fillRule="evenodd" className="ms-region" />

          {stage === 1 && <path d={edgesPath(m.cdt)} className="ms-edge" />}

          {stage === 2 && (
            <>
              <path d={edgesPath(m.obtuse.mesh)} className="ms-edge" />
              {m.obtuse.checks.map((c, i) => (
                <g key={i}>
                  <polygon points={c.tri.map((p) => p.join(',')).join(' ')} className="ms-obtuse" />
                  <line x1={c.from[0]} y1={c.from[1]} x2={c.to[0]} y2={c.to[1]} className={c.hit ? 'ms-ray bad' : 'ms-ray ok'} />
                  <circle cx={c.to[0]} cy={c.to[1]} r={3 * px} className="ms-cc" />
                </g>
              ))}
              {dots(m.obtuse.checks.flatMap((c) => (c.steiner ? [c.steiner] : [])), 'ms-steiner', 4.5)}
            </>
          )}

          {stage === 3 && (
            <>
              <path d={edgesPath(m.mesh)} className="ms-edge" />
              {m.mesh.tris.map((t, i) =>
                m.types[i] === 'B' ? <polygon key={i} points={triPoints(m.mesh, t)} className="ms-ear" /> : null,
              )}
              {m.convex.corners.map((c, i) => (
                <circle key={i} cx={c.v[0]} cy={c.v[1]} r={c.radius / 2} className="ms-halfcircle" />
              ))}
              {dots(
                [...m.convex.corners.flatMap((c) => [c.s1, c.s2]), ...m.recheck.flatMap((c) => (c.steiner ? [c.steiner] : []))],
                'ms-steiner',
                4.5,
              )}
            </>
          )}

          {stage >= 4 &&
            m.mesh.tris.map((t, i) => (
              <polygon
                key={i}
                points={triPoints(m.mesh, t)}
                className={`${TYPE_CLASS[m.types[i]]} ${stage >= 5 ? 'dim' : ''} ${stage === 5 && disabled.has(i) ? 'disabled' : ''}`}
              />
            ))}

          {stage === 5 && (
            <>
              {m.axis.polylines.map((l, i) => (
                <polyline key={i} points={linePoints(l)} className="ms-axis" />
              ))}
              {dots(m.axis.midpoints, 'ms-mid', 2.4)}
              {dots(m.axis.centers, 'ms-center', 3.6)}
              {dots(m.axis.corners, 'ms-corner', 3.6)}
            </>
          )}

          {stage === 6 && (
            <>
              {m.axis.spurs.map((l, i) => (
                <polyline key={`s${i}`} points={linePoints(l)} className="ms-spur" />
              ))}
              {m.axis.trimmed.map((l, i) => (
                <polyline key={i} points={linePoints(l)} className="ms-axis" />
              ))}
              {dots(m.axis.centers, 'ms-center', 3.6)}
            </>
          )}

          <path d={region} fillRule="evenodd" className="ms-wall" />
          {stage <= 1 && dots(m.cdt.points, 'ms-vertex', 2.8)}
        </svg>

        <div className="ms-scrub">
          <button className="ms-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : stage >= LAST ? '↺' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={LAST}
            step={1}
            value={stage}
            list="ms-step-ticks"
            aria-label="Step"
            onChange={(e) => show(Number(e.target.value))}
          />
          <datalist id="ms-step-ticks">
            {STAGES.map((_, i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          <span className="ms-scrub-label">
            Step {stage} / {LAST}
          </span>
        </div>
      </div>

      <div className="ms-side">
        <Segmented
          label="Shape"
          value={shapeId}
          onChange={(id) => replay(id)}
          options={SHAPES.map((s) => ({ value: s.id, label: s.label }))}
        />
        <ol className="ms-steps">
          {STAGES.map((s, i) => (
            <li key={s.title}>
              <button className={i === stage ? 'on' : ''} onClick={() => show(i)}>
                <span>{i}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <p className="ms-text">{STAGES[stage].text}</p>
        {stage === 2 && !m.obtuse.checks.length && (
          <p className="ms-hint">No obtuse junction triangles in this shape. The bracket has some.</p>
        )}
        {stage >= 4 && (
          <div className="ms-legend">
            <span className="chip tri-a">A · {counts.A}</span>
            <span className="chip tri-b">B · {counts.B}</span>
            <span className="chip tri-c">C · {counts.C}</span>
            {stage === 6 && <span className="chip spur">dropped · {m.axis.spurs.length}</span>}
          </div>
        )}
        <div className="ms-stats">
          {m.cdt.points.length} vertices · +{added21} Steiner (§2.1) · +{m.mesh.points.length - m.cdt.points.length - added21}{' '}
          Steiner (§2.2) · {m.mesh.tris.length} triangles
        </div>
      </div>
    </div>
  );
}
