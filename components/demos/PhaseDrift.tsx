'use client';

import { useMemo, useState } from 'react';
import { Segmented, Slider } from '../ui';

// Toy model: a remote panel refreshes at 90 Hz on its own crystal; the host emulates its vblank.
// Without feedback the emulated vblank free-runs at the nominal period; with feedback a small
// phase + frequency loop nudges it every flip using noisy timing reports.
const FPS = 90;
const T = 1000 / FPS; // nominal period, ms
const SECONDS = 120;
const KP = 0.08; // phase gain per flip
const KI = 0.004; // frequency gain per flip

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(ppm: number, noiseMs: number) {
  const rand = mulberry32(42);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const truePeriod = T * (1 + ppm * 1e-6);
  const frames = SECONDS * FPS;
  const step = 15;
  const free: [number, number][] = [];
  const locked: [number, number][] = [];
  let e = 0; // emulated − real vblank, ms
  let period = T;
  const tail: number[] = [];
  for (let n = 0; n <= frames; n++) {
    const freeErr = n * (T - truePeriod);
    const measured = e + gauss() * noiseMs;
    e -= KP * measured;
    period -= KI * measured;
    if (n % step === 0) {
      free.push([n / FPS, freeErr]);
      locked.push([n / FPS, e]);
    }
    if (n > frames / 2) tail.push(Math.abs(e));
    e += period - truePeriod;
  }
  tail.sort((a, b) => a - b);
  return { free, locked, freeEnd: Math.abs(free[free.length - 1][1]), p99: tail[Math.floor(tail.length * 0.99)] };
}

const W = 760;
const H = 300;
const PAD = { l: 56, r: 16, t: 14, b: 34 };

export default function PhaseDrift() {
  const [ppm, setPpm] = useState(50);
  const [noise, setNoise] = useState(0.3);
  const [loop, setLoop] = useState(true);
  const sim = useMemo(() => simulate(ppm, noise), [ppm, noise]);

  const yMax = Math.max(2, Math.ceil(sim.freeEnd));
  const x = (s: number) => PAD.l + (s / SECONDS) * (W - PAD.l - PAD.r);
  const y = (ms: number) => PAD.t + ((yMax - ms) / (2 * yMax)) * (H - PAD.t - PAD.b);
  const line = (pts: [number, number][]) => pts.map(([s, ms], i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)} ${y(ms).toFixed(1)}`).join('');
  const ticks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];

  return (
    <div className="drift">
      <svg viewBox={`0 0 ${W} ${H}`} className="drift-svg">
        <defs>
          <filter id="dr-blur" x="-5%" y="-20%" width="110%" height="140%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'dr-zero' : 'dr-grid'} />
            <text x={PAD.l - 8} y={y(v) + 5} textAnchor="end" className="dr-axis">
              {v.toFixed(v % 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {[0, 30, 60, 90, 120].map((s) => (
          <text key={s} x={x(s)} y={H - 10} textAnchor="middle" className="dr-axis">
            {s}s
          </text>
        ))}
        <text x={14} y={PAD.t + 8} className="dr-axis">
          ms
        </text>
        {/* With the loop on, the free-running line fades into the background for contrast. */}
        <path d={line(sim.free)} className={loop ? 'dr-free ghost' : 'dr-free'} filter={loop ? 'url(#dr-blur)' : undefined} />
        {loop && <path d={line(sim.locked)} className="dr-locked" />}
      </svg>
      <div className="drift-side">
        <Slider label="Clock mismatch" value={ppm} min={0} max={200} step={5} format={(v) => `${v} ppm`} onChange={setPpm} />
        <Slider
          label="Feedback timestamp noise"
          value={noise}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${v.toFixed(2)} ms`}
          onChange={setNoise}
        />
        <Segmented
          label="Feedback loop"
          value={loop}
          onChange={setLoop}
          options={[
            { value: false, label: 'Free-running' },
            { value: true, label: 'Re-phase every flip' },
          ]}
        />
        <div className={loop ? 'readout bad faded' : 'readout bad'}>
          <span className="control-label">Free-running after 2 min</span>
          <b>{sim.freeEnd.toFixed(1)} ms</b>
        </div>
        {loop && (
          <div className="readout good">
            <span className="control-label">Locked, p99 |error|</span>
            <b>{(sim.p99 * 1000).toFixed(0)} µs</b>
          </div>
        )}
      </div>
    </div>
  );
}
