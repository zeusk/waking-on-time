'use client';

import { useEffect, useMemo, useState } from 'react';
import { Segmented, Slider } from '../ui';

const PERIOD = 1000 / 90;
const FRAMES = 5;
const W = 1420;
const PAD = 30;
const PX = (W - PAD * 2) / (FRAMES * PERIOD);
const x = (t: number) => PAD + t * PX;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wake-up delay after the requested time: exponential, so there's a long tail like a real scheduler.
const wakeDelay = (r: () => number, mean: number) => -Math.log(1 - r()) * mean;

type Preset = 'timer' | 'fence' | 'custom';
const PRESETS: Record<Exclude<Preset, 'custom'>, { offset: number; jitter: number }> = {
  timer: { offset: 4, jitter: 1.2 },
  fence: { offset: 2, jitter: 0.08 },
};

export default function VsyncTimeline({ active }: { active: boolean }) {
  const [offset, setOffset] = useState(4);
  const [cost, setCost] = useState(1.2);
  const [jitter, setJitter] = useState(1.2);
  const [preset, setPreset] = useState<Preset>('timer');
  const [seed, setSeed] = useState(7);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeed((s) => s + 1), 1400);
    return () => clearInterval(id);
  }, [active]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      setOffset(PRESETS[p].offset);
      setJitter(PRESETS[p].jitter);
    }
  };

  const stats = useMemo(() => {
    const r = mulberry32(12345);
    const N = 20000;
    let misses = 0;
    let poseAge = 0;
    for (let i = 0; i < N; i++) {
      const d = wakeDelay(r, jitter);
      if (d + cost > offset) misses++;
      poseAge += Math.max(0, offset - d);
    }
    return { missRate: (misses / N) * 100, poseToPhoton: poseAge / N + PERIOD / 2 };
  }, [offset, cost, jitter]);

  const frames = useMemo(() => {
    const r = mulberry32(seed);
    return Array.from({ length: FRAMES }, (_, k) => {
      const vsync = (k + 1) * PERIOD;
      const target = vsync - offset;
      const wake = target + wakeDelay(r, jitter);
      return { vsync, target, wake, end: wake + cost, miss: wake + cost > vsync };
    });
  }, [seed, offset, cost, jitter]);

  return (
    <div className="vsync">
      <svg viewBox={`0 0 ${W} 250`} className="vs-svg">
        <line x1={PAD} x2={W - PAD} y1={150} y2={150} className="vs-axis" />
        {Array.from({ length: FRAMES + 1 }, (_, k) => (
          <g key={k}>
            <line x1={x(k * PERIOD)} x2={x(k * PERIOD)} y1={30} y2={200} className="vs-vsync" />
            <text x={x(k * PERIOD)} y={225} textAnchor="middle" className="vs-label">
              vsync
            </text>
          </g>
        ))}
        {frames.map((f, i) => (
          <g key={i}>
            <line x1={x(f.target)} x2={x(f.target)} y1={60} y2={150} className="vs-target" />
            <text x={x(f.target)} y={52} textAnchor="middle" className="vs-target-label">
              wake
            </text>
            <rect
              x={x(f.wake)}
              y={95}
              width={Math.max(2, (f.end - f.wake) * PX)}
              height={40}
              rx={5}
              className={f.miss ? 'vs-block miss' : 'vs-block'}
            />
            <circle cx={x(f.wake)} cy={115} r={5} className="vs-pose" />
            {f.miss && (
              <text x={x(f.vsync) + 8} y={88} className="vs-miss">
                MISS
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="vs-bottom">
        <div className="controls vs-controls">
          <Segmented
            label="Wake-up source"
            value={preset}
            onChange={applyPreset}
            options={[
              { value: 'timer', label: 'Coarse timer' },
              { value: 'fence', label: 'Vsync-locked fence' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          <Slider
            label="Wake offset before vsync"
            value={offset}
            min={0.5}
            max={8}
            step={0.1}
            format={(v) => `${v.toFixed(1)} ms`}
            onChange={(v) => {
              setOffset(v);
              setPreset('custom');
            }}
          />
          <Slider
            label="LSR cost"
            value={cost}
            min={0.3}
            max={4}
            step={0.1}
            format={(v) => `${v.toFixed(1)} ms`}
            onChange={setCost}
          />
          <Slider
            label="Wake-up jitter (mean)"
            value={jitter}
            min={0}
            max={3}
            step={0.02}
            format={(v) => `${v.toFixed(2)} ms`}
            onChange={(v) => {
              setJitter(v);
              setPreset('custom');
            }}
          />
        </div>
        <div className="vs-stats">
          <div className={`readout ${stats.missRate > 1 ? 'bad' : 'good'}`}>
            <span className="control-label">Missed vsyncs</span>
            <b>{stats.missRate < 0.01 ? '<0.01' : stats.missRate.toFixed(2)}%</b>
          </div>
          <div className="readout">
            <span className="control-label">Pose → mid-screen photons</span>
            <b>{stats.poseToPhoton.toFixed(1)} ms</b>
          </div>
        </div>
      </div>
    </div>
  );
}
