'use client';

import { useEffect, useRef, useState } from 'react';
import { Segmented, Slider } from '../ui';

const W = 1060;
const H = 470;
const RES = 2; // canvas backing-store scale, keeps it crisp on a projector
const FOV = 100; // horizontal field of view, degrees
const PPD = W / FOV; // pixels per degree (small-angle approximation of the rotation warp)
const HORIZON = H * 0.6;
const LSR_LATENCY = 3; // ms between the LSR pose sample and photons
// The headset display is simulated at a fixed 90 Hz, whatever rate the monitor showing the slide runs at.
const REFRESH_HZ = 90;
const REFRESH_MS = 1000 / REFRESH_HZ;
const STRIP = REFRESH_HZ; // one second of refreshes; a cursor sweeps across and overwrites them
const SWEEP_S = 2.6; // period of the automatic head sweep
const ERR_WINDOW = Math.round(SWEEP_S * REFRESH_HZ); // average the error over a whole sweep, not one moment of it

const PALETTE = ['#4cc9f0', '#f4a259', '#5bd69a', '#c792ea', '#ff7b8a', '#f7d774'];
const OBJECTS = Array.from({ length: 12 }, (_, i) => ({
  az: i * 30 - 165,
  label: 'ABCDEFGHIJKL'[i],
  color: PALETTE[i % PALETTE.length],
}));

const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const screenX = (az: number, yaw: number) => W / 2 + wrap(az - yaw) * PPD;
const autoYaw = (s: number) => 34 * Math.sin((2 * Math.PI * s) / SWEEP_S) + 9 * Math.sin((2 * Math.PI * s) / 0.8);

function drawWorld(ctx: CanvasRenderingContext2D, yaw: number) {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#0b1626');
  sky.addColorStop(1, '#1b3047');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, HORIZON, W, H - HORIZON);

  ctx.strokeStyle = 'rgba(140,170,200,0.18)';
  ctx.lineWidth = 1;
  for (let az = -180; az < 180; az += 10) {
    const x = screenX(az, yaw);
    if (x < -20 || x > W + 20) continue;
    ctx.beginPath();
    ctx.moveTo(x, HORIZON);
    ctx.lineTo(W / 2 + (x - W / 2) * 3, H);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(140,170,200,0.5)';
  ctx.beginPath();
  ctx.moveTo(0, HORIZON);
  ctx.lineTo(W, HORIZON);
  ctx.stroke();

  ctx.font = '600 28px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const o of OBJECTS) {
    const x = screenX(o.az, yaw);
    if (x < -80 || x > W + 80) continue;
    ctx.fillStyle = o.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x - 22, HORIZON - 170, 44, 230);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, HORIZON - 205, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0f14';
    ctx.fillText(o.label, x, HORIZON - 195);
  }
}

function outlineWorld(ctx: CanvasRenderingContext2D, yaw: number) {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  for (const o of OBJECTS) {
    const x = screenX(o.az, yaw);
    if (x < -80 || x > W + 80) continue;
    ctx.strokeRect(x - 22, HORIZON - 170, 44, 230);
    ctx.beginPath();
    ctx.arc(x, HORIZON - 205, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function makeHatch(ctx: CanvasRenderingContext2D) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#140b0e';
  g.fillRect(0, 0, 16, 16);
  g.strokeStyle = 'rgba(255,93,108,0.4)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 16);
  g.lineTo(16, 0);
  g.stroke();
  return ctx.createPattern(c, 'repeat')!;
}

/** What the app delivered for one display refresh. */
type Refresh = 'new' | 'none' | 'missed';
const REFRESH_COLOR: Record<Refresh, string> = { new: '#4cc9f0', none: 'rgba(135,150,168,0.4)', missed: '#ff5d6c' };
const REFRESH_LABEL: [Refresh, string][] = [
  ['new', 'new frame'],
  ['none', 'no new frame'],
  ['missed', 'missed vsync'],
];

function drawStrip(ctx: CanvasRenderingContext2D, refreshes: (Refresh | null)[], cursor: number) {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  const cell = 5;
  const gap = 1;
  const x0 = 18;
  const y0 = H - 54;
  ctx.fillStyle = 'rgba(7, 9, 13, 0.8)';
  ctx.fillRect(x0 - 10, y0 - 10, STRIP * (cell + gap) - gap + 20, 54);

  ctx.font = '500 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8796a8';
  const title = `${REFRESH_HZ} HZ DISPLAY`;
  ctx.fillText(title, x0, y0 + 5);
  let x = x0 + ctx.measureText(title).width + 22;
  for (const [kind, label] of REFRESH_LABEL) {
    ctx.fillStyle = REFRESH_COLOR[kind];
    ctx.fillRect(x, y0, 10, 10);
    ctx.fillStyle = '#c3ccd8';
    ctx.fillText(label, x + 16, y0 + 5);
    x += 16 + ctx.measureText(label).width + 18;
  }
  ctx.textBaseline = 'alphabetic';

  refreshes.forEach((r, i) => {
    ctx.fillStyle = r ? REFRESH_COLOR[r] : 'rgba(135,150,168,0.12)';
    ctx.fillRect(x0 + i * (cell + gap), y0 + 18, cell, 16);
  });
  ctx.fillStyle = '#e8edf4';
  ctx.fillRect(x0 + cursor * (cell + gap), y0 + 36, cell, 2);
}

type Params = { lsr: boolean; latency: number; fps: number; miss: number; head: 'auto' | 'mouse'; truth: boolean };

export default function ReprojectionDemo({ active }: { active: boolean }) {
  const [lsr, setLsr] = useState(false);
  const [latency, setLatency] = useState(30);
  const [fps, setFps] = useState(90);
  const [miss, setMiss] = useState(0); // % of app frames that are not ready by their vsync
  const [head, setHead] = useState<'auto' | 'mouse'>('auto');
  const [truth, setTruth] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const errRef = useRef<HTMLElement>(null);
  const mouseYaw = useRef(0);
  const params = useRef<Params>({ lsr, latency, fps, miss, head, truth });
  params.current = { lsr, latency, fps, miss, head, truth };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    if (!active) {
      drawWorld(ctx, 0);
      return;
    }

    const off = document.createElement('canvas');
    off.width = W * RES;
    off.height = H * RES;
    const octx = off.getContext('2d')!;
    drawWorld(octx, 0);
    const hatch = makeHatch(ctx);

    const t0 = performance.now();
    const history: { t: number; yaw: number }[] = [];
    let frameYaw = 0;
    let late: number | null = null; // pose of a frame that missed its vsync, still waiting to go up
    let vsync = -1; // last simulated display refresh
    let appPhase = 1; // the app has a frame due whenever this reaches 1
    const refreshes: (Refresh | null)[] = Array(STRIP).fill(null);
    let cursor = STRIP - 1;
    const errs = new Float64Array(ERR_WINDOW);
    let errSum = 0;
    let errCount = 0;
    let errAt = 0;
    let lastReadout = 0;
    let raf = 0;

    const poseAt = (t: number) => {
      if (params.current.head === 'auto') return autoYaw((t - t0) / 1000);
      if (!history.length || t <= history[0].t) return history[0]?.yaw ?? 0;
      for (let i = history.length - 1; i > 0; i--) {
        const a = history[i - 1];
        const b = history[i];
        if (a.t <= t) return a.yaw + (b.yaw - a.yaw) * Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t));
      }
      return history[history.length - 1].yaw;
    };

    const tick = (now: number) => {
      const p = params.current;
      history.push({ t: now, yaw: p.head === 'auto' ? autoYaw((now - t0) / 1000) : mouseYaw.current });
      while (history.length > 2 && history[0].t < now - 600) history.shift();

      const target = Math.floor((now - t0) / REFRESH_MS);
      if (target - vsync > STRIP) vsync = target - STRIP; // after a stall, only simulate the last second
      let tv: number | null = null; // time of the latest simulated refresh, if one happened this tick
      let redraw = false;
      while (vsync < target) {
        vsync++;
        tv = t0 + vsync * REFRESH_MS;

        // The "app" renders at its own rate using a pose that is `latency` ms old by the time it is shown.
        // A frame that misses its vsync is not ready in time: the display shows the previous frame again,
        // and the late frame goes up on the next refresh unless a newer frame replaces it.
        let refresh: Refresh = 'none';
        appPhase += p.fps / REFRESH_HZ;
        if (appPhase >= 1 - 1e-9) {
          appPhase -= 1;
          const pose = poseAt(tv - p.latency);
          if (Math.random() * 100 < p.miss) {
            late = pose;
            refresh = 'missed';
          } else {
            late = null;
            frameYaw = pose;
            refresh = 'new';
          }
        } else if (late !== null) {
          frameYaw = late;
          late = null;
          refresh = 'new';
        }
        if (refresh === 'new') redraw = true;
        cursor = (cursor + 1) % STRIP;
        refreshes[cursor] = refresh;

        const err = Math.abs((p.lsr ? poseAt(tv - LSR_LATENCY) : frameYaw) - poseAt(tv));
        errSum += err - errs[errAt];
        errs[errAt] = err;
        errAt = (errAt + 1) % ERR_WINDOW;
        errCount = Math.min(ERR_WINDOW, errCount + 1);
      }

      if (tv !== null) {
        if (redraw) drawWorld(octx, frameYaw);
        // LSR: shift the finished frame by the rotation between its pose and a pose sampled just before scanout.
        const dx = p.lsr ? (frameYaw - poseAt(tv - LSR_LATENCY)) * PPD : 0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = hatch;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(off, Math.round(dx * RES), 0);
        if (p.truth) outlineWorld(ctx, poseAt(tv));
        drawStrip(ctx, refreshes, cursor);
      }
      if (now - lastReadout > 120 && errRef.current) {
        lastReadout = now;
        errRef.current.textContent = `${(errCount ? errSum / errCount : 0).toFixed(1)}°`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mouseYaw.current = ((e.clientX - r.left) / r.width - 0.5) * 120;
  };

  return (
    <div className="reproj">
      <canvas
        ref={canvasRef}
        width={W * RES}
        height={H * RES}
        style={{ width: W, height: H }}
        onPointerMove={onPointerMove}
        className="reproj-canvas"
      />
      <div className="reproj-side">
        <Segmented
          label="Late-stage reprojection"
          value={lsr}
          onChange={setLsr}
          options={[
            { value: false, label: 'Off' },
            { value: true, label: 'On' },
          ]}
        />
        <Slider
          label="Render pipeline latency"
          value={latency}
          min={0}
          max={60}
          format={(v) => `${v} ms`}
          onChange={setLatency}
        />
        <Segmented
          label="App frame rate"
          value={fps}
          onChange={setFps}
          options={[
            { value: 90, label: '90' },
            { value: 45, label: '45' },
            { value: 20, label: '20' },
          ]}
        />
        <Slider
          label="Frames that miss vsync"
          value={miss}
          min={0}
          max={50}
          step={5}
          format={(v) => `${v}%`}
          onChange={setMiss}
        />
        <Segmented
          label="Head motion"
          value={head}
          onChange={setHead}
          options={[
            { value: 'auto', label: 'Auto sweep' },
            { value: 'mouse', label: 'Follow mouse' },
          ]}
        />
        <Segmented
          label="Where it should be"
          value={truth}
          onChange={setTruth}
          options={[
            { value: true, label: 'Show' },
            { value: false, label: 'Hide' },
          ]}
        />
        <div className="readout">
          <span className="control-label">Avg. image error</span>
          <b ref={errRef}>0.0°</b>
        </div>
      </div>
    </div>
  );
}
