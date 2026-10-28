'use client';

import { useState } from 'react';
import { Segmented } from '../ui';

// Illustrative 90 Hz pipeline. All times in ms, t = 0 is when the app samples the head pose.
const PERIOD = 11.1;
const VSYNC = 16;
const LSR_START = 13; // compositor wakes 3 ms before vsync
const LSR_END = 14.5;
const PHOTON = VSYNC + PERIOD / 2; // mid-screen row lights up halfway through scanout
const T_MIN = -12;
const T_MAX = 30;

const W = 1420;
const LABEL_W = 190;
const PX = (W - LABEL_W - 20) / (T_MAX - T_MIN);
const x = (t: number) => LABEL_W + (t - T_MIN) * PX;

const ROWS = { pose: 50, app: 125, comp: 200, display: 275 };
const ROW_H = 44;

function Block({
  t0,
  t1,
  row,
  label,
  tone,
  faded,
}: {
  t0: number;
  t1: number;
  row: number;
  label: string;
  tone: 'app' | 'lsr' | 'plain' | 'display' | 'bad';
  faded?: boolean;
}) {
  return (
    <g className={`lb-block lb-${tone}`} opacity={faded ? 0.35 : 1}>
      <rect x={x(t0)} y={row - ROW_H / 2} width={(t1 - t0) * PX} height={ROW_H} rx={6} />
      <text x={x(t0) + 12} y={row + 7}>
        {label}
      </text>
    </g>
  );
}

export default function LatencyBudget() {
  const [lsr, setLsr] = useState(false);
  const [missed, setMissed] = useState(false);

  const poseT = lsr ? LSR_START : missed ? -PERIOD : 0;
  const latency = PHOTON - poseT;
  const ok = latency <= 20;

  let shown = 'New frame';
  if (missed && !lsr) shown = 'Repeats previous frame (judder)';
  if (missed && lsr) shown = 'Previous frame, re-warped to new pose';
  if (!missed && lsr) shown = 'New frame, re-warped to new pose';

  return (
    <div className="latency">
      <div className="controls">
        <Segmented
          label="Compositor"
          value={lsr}
          onChange={setLsr}
          options={[
            { value: false, label: 'Plain compose' },
            { value: true, label: 'Late-stage reprojection' },
          ]}
        />
        <Segmented
          label="App frame"
          value={missed}
          onChange={setMissed}
          options={[
            { value: false, label: 'On time' },
            { value: true, label: 'Misses vsync' },
          ]}
        />
        <div className={`readout ${ok ? 'good' : 'bad'}`}>
          <span className="control-label">Pose → mid-screen photons</span>
          <b>{latency.toFixed(1)} ms</b>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} 360`} className="lb-svg">
        {/* time grid */}
        {Array.from({ length: (T_MAX - T_MIN) / 2 + 1 }, (_, i) => T_MIN + i * 2).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={20} y2={305} className="lb-grid" />
            <text x={x(t)} y={330} className="lb-axis" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text x={W - 10} y={352} className="lb-axis" textAnchor="end">
          ms
        </text>

        {[VSYNC - PERIOD, VSYNC, VSYNC + PERIOD].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={14} y2={305} className="lb-vsync" />
            <text x={x(t) + 6} y={22} className="lb-vsync-label">
              vsync
            </text>
          </g>
        ))}

        {Object.entries({ pose: 'Head pose', app: 'App GPU', comp: 'Compositor', display: 'Display' }).map(
          ([k, label]) => (
            <text key={k} x={8} y={ROWS[k as keyof typeof ROWS] + 7} className="lb-row-label">
              {label}
            </text>
          ),
        )}

        {/* previous frame (shown when the current one is late) */}
        <Block t0={-PERIOD + 0.5} t1={0.5 - 0.3} row={ROWS.app} label="Previous frame" tone="app" faded />
        <Block
          t0={0.5}
          t1={missed ? 0.5 + PERIOD * 2 - 1.5 : 0.5 + PERIOD - 1.5}
          row={ROWS.app}
          label={missed ? 'Render (overruns vsync)' : 'Render frame N'}
          tone={missed ? 'bad' : 'app'}
        />
        <Block
          t0={LSR_START}
          t1={LSR_END}
          row={ROWS.comp}
          label={lsr ? 'LSR' : 'Copy'}
          tone={lsr ? 'lsr' : 'plain'}
        />
        <Block t0={VSYNC} t1={VSYNC + PERIOD} row={ROWS.display} label={shown} tone="display" />

        {/* pose sample → photons bracket */}
        <line
          x1={x(poseT)}
          x2={x(PHOTON)}
          y1={ROWS.pose}
          y2={ROWS.pose}
          className={`lb-bracket ${ok ? 'good' : 'bad'}`}
        />
        <circle cx={x(poseT)} cy={ROWS.pose} r={9} className="lb-pose" />
        <text x={x(poseT)} y={ROWS.pose - 18} className="lb-pose-label" textAnchor="middle">
          pose sampled
        </text>
        <line x1={x(PHOTON)} x2={x(PHOTON)} y1={ROWS.pose} y2={ROWS.display - ROW_H / 2} className="lb-photon" />
        <circle cx={x(PHOTON)} cy={ROWS.display - ROW_H / 2} r={7} className="lb-photon-dot" />
        <text x={x(PHOTON) + 10} y={ROWS.pose - 12} className="lb-pose-label">
          photons
        </text>
      </svg>
      <p className="caption">
        Illustrative 90 Hz pipeline. Roughly 20 ms motion-to-photon is a commonly cited comfort target.
      </p>
    </div>
  );
}
