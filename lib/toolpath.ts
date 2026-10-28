// Turning a medial axis into toolpaths: continuous-fibre strands and thin-region beads.
import { add, cross, dist, dot, len, lerp, mul, norm, polylineLength, simplify, sub, type Pt } from './geometry';
import type { Graph, Shape } from './mat';

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const f = (n: number) => n.toFixed(3);

/* ---------- 1. break the axis graph into segments between junctions and ends ---------- */

type Piece = { ids: number[]; closed: boolean };

function decompose(g: Graph): Piece[] {
  const adj = g.nodes.map(() => [] as number[]);
  for (const [a, b] of g.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const used = new Set<string>();
  const pieces: Piece[] = [];
  const walk = (u: number, v: number) => {
    const ids = [u];
    let prev = u;
    let cur = v;
    used.add(key(u, v));
    while (adj[cur].length === 2 && cur !== u) {
      ids.push(cur);
      const next = adj[cur].find((x) => x !== prev && !used.has(key(cur, x)));
      if (next === undefined) break;
      used.add(key(cur, next));
      prev = cur;
      cur = next;
    }
    ids.push(cur);
    return ids;
  };
  adj.forEach((ns, u) => {
    if (ns.length === 2 || !ns.length) return;
    for (const v of ns) if (!used.has(key(u, v))) pieces.push({ ids: walk(u, v), closed: false });
  });
  // Whatever is left are loops with no junction, e.g. around a hole.
  for (const [a, b] of g.edges) {
    if (used.has(key(a, b))) continue;
    const ids = walk(a, b);
    pieces.push({ ids, closed: ids[0] === ids[ids.length - 1] });
  }
  return pieces;
}

/* ---------- 2. rebuild strands that respect the fibre's constraints ---------- */

export type FibreOptions = {
  width: number;
  minLength: number;
  minBend: number;
  maxJoinTurnDeg?: number;
  /** Distance to the nearest wall. When given, every bend must also keep half a fibre width of clearance. */
  distToWall?: (p: Pt) => number;
};
export type Strand = { pts: Pt[]; closed: boolean; length: number; d: string };
export type FibreResult = {
  segments: Pt[][];
  strands: Strand[];
  short: Pt[][];
  thin: Pt[][];
  bendBreaks: Pt[];
  cuts: Pt[];
};

type Run = { pts: Pt[]; start: number | null; end: number | null; closed: boolean };

/** Fillet every corner with the bend radius; callers guarantee each fillet fits. */
export function filletPath(pts: Pt[], closed: boolean, radius: number) {
  const n = pts.length;
  const corner = (i: number) => {
    const p = pts[(i + n) % n];
    const u1 = norm(sub(p, pts[(i - 1 + n) % n]));
    const u2 = norm(sub(pts[(i + 1) % n], p));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (phi < 0.01) return ` L${f(p[0])} ${f(p[1])}`;
    const t = radius * Math.tan(phi / 2);
    const a = sub(p, mul(u1, t));
    const b = add(p, mul(u2, t));
    return ` L${f(a[0])} ${f(a[1])} A${f(radius)} ${f(radius)} 0 0 ${cross(u1, u2) > 0 ? 1 : 0} ${f(b[0])} ${f(b[1])}`;
  };
  if (!closed) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < n - 1; i++) d += corner(i);
    return d + ` L${f(pts[n - 1][0])} ${f(pts[n - 1][1])}`;
  }
  const start = lerp(pts[0], pts[1], 0.5);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 1; i <= n; i++) d += corner(i);
  return d + ' Z';
}

/** Length along each leg that a fillet of `radius` at vertex i takes up (0 at the ends of an open path). */
function tangent(pts: Pt[], i: number, radius: number, closed: boolean) {
  const n = pts.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const p = pts[i];
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(p, pts[(i - 1 + n) % n])), norm(sub(pts[(i + 1) % n], p))))));
  return phi < 0.01 ? 0 : radius * Math.tan(phi / 2);
}

/** Both fillets around the segment from i to the next vertex fit on it. */
const segmentFits = (pts: Pt[], i: number, radius: number, closed: boolean) =>
  tangent(pts, i, radius, closed) + tangent(pts, (i + 1) % pts.length, radius, closed) <= dist(pts[i], pts[(i + 1) % pts.length]) + 1e-9;

/** Points along the fillet arc at vertex i, where it bows furthest from the corner. */
function arcSamples(pts: Pt[], i: number, radius: number, closed: boolean): Pt[] {
  const t = tangent(pts, i, radius, closed);
  if (t === 0) return [];
  const n = pts.length;
  const p = pts[i];
  const u1 = norm(sub(p, pts[(i - 1 + n) % n]));
  const u2 = norm(sub(pts[(i + 1) % n], p));
  const side = cross(u1, u2) > 0 ? 1 : -1;
  const a = sub(p, mul(u1, t));
  const c = add(a, mul([-u1[1] * side, u1[0] * side], radius));
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  return [0.25, 0.5, 0.75].map((k) => {
    const ang = side * phi * k;
    const v = sub(a, c);
    return add(c, [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)]);
  });
}

function bendFits(pts: Pt[], i: number, radius: number, closed: boolean, clear?: (p: Pt) => boolean) {
  const n = pts.length;
  if (!segmentFits(pts, (i - 1 + n) % n, radius, closed) || !segmentFits(pts, i, radius, closed)) return false;
  return !clear || arcSamples(pts, i, radius, closed).every(clear);
}

function lineHit(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  return add(a, mul(r, cross(sub(c, a), s) / den));
}

/**
 * The axis often turns a corner over two vertices a short segment apart, too close for both
 * fillets. Replace such a pair with the single corner where the neighbouring segments meet.
 */
function mergeCorners(input: Pt[], closed: boolean, radius: number, maxShift: number) {
  const pts = input.slice();
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    const n = pts.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 2); i++) {
      const j = (i + 1) % n;
      if (segmentFits(pts, i, radius, closed)) continue;
      const a = pts[(i - 1 + n) % n];
      const b = pts[(j + 1) % n];
      const x = lineHit(a, pts[i], pts[j], b);
      if (!x || dist(x, pts[i]) > maxShift || dist(x, pts[j]) > maxShift) continue;
      if (dot(sub(x, a), sub(pts[i], a)) <= 0 || dot(sub(b, x), sub(b, pts[j])) <= 0) continue;
      if (j > i) pts.splice(i, 2, x);
      else pts.splice(i, 1, x), pts.shift();
      changed = true;
      break;
    }
  }
  return pts;
}

export function fibreToolpaths(g: Graph, opts: FibreOptions): FibreResult {
  const { width, minLength, minBend, distToWall } = opts;
  const clear = distToWall && ((p: Pt) => distToWall(p) >= width / 2 - 1e-9);
  const maxTurn = ((opts.maxJoinTurnDeg ?? 70) * Math.PI) / 180;
  const deg = g.nodes.map(() => 0);
  for (const [a, b] of g.edges) {
    deg[a]++;
    deg[b]++;
  }
  const pieces = decompose(g);
  const segments = pieces.map((p) => p.ids.map((i) => g.nodes[i].p));

  // Trim wherever the region is narrower than one fibre: those parts run into corners.
  const runs: Run[] = [];
  const thin: Pt[][] = [];
  for (const piece of pieces) {
    let ids = piece.ids;
    const ok = (i: number) => g.nodes[i].r >= width / 2;
    if (piece.closed && ids.every(ok)) {
      runs.push({ pts: ids.slice(0, -1).map((i) => g.nodes[i].p), start: null, end: null, closed: true });
      continue;
    }
    if (piece.closed) {
      const k = ids.slice(0, -1).reduce((m, i, j, arr) => (g.nodes[i].r < g.nodes[arr[m]].r ? j : m), 0);
      ids = [...ids.slice(k, -1), ...ids.slice(0, k + 1)];
    }
    let cur: Pt[] = [];
    let thinCur: Pt[] = [];
    let curStart: number | null = null;
    const junction = (i: number) => (deg[ids[i]] >= 3 ? ids[i] : null);
    ids.forEach((id, i) => {
      const p = g.nodes[id].p;
      if (i > 0) {
        const a = g.nodes[ids[i - 1]];
        const b = g.nodes[id];
        if (ok(ids[i - 1]) !== ok(id)) {
          const t = (width / 2 - a.r) / (b.r - a.r);
          const x = lerp(a.p, b.p, Math.max(0, Math.min(1, t)));
          if (ok(ids[i - 1])) {
            cur.push(x);
            if (cur.length > 1) runs.push({ pts: cur, start: curStart, end: null, closed: false });
            cur = [];
            thinCur = [x];
          } else {
            thinCur.push(x);
            thin.push(thinCur);
            thinCur = [];
            cur = [x];
            curStart = null;
          }
        }
      } else {
        curStart = ok(id) ? junction(0) : null;
      }
      if (ok(id)) cur.push(p);
      else thinCur.push(p);
    });
    if (cur.length > 1) runs.push({ pts: cur, start: curStart, end: junction(ids.length - 1), closed: false });
    if (thinCur.length > 1) thin.push(thinCur);
  }

  for (const r of runs) if (!r.closed) r.pts = simplify(r.pts, width * 0.35);

  // Join runs across junctions where the fibre can carry straight on.
  const ends = new Map<number, { run: number; end: 0 | 1; dir: Pt }[]>();
  runs.forEach((r, i) => {
    if (r.closed || r.pts.length < 2) return;
    const n = r.pts.length;
    if (r.start !== null) ends.set(r.start, [...(ends.get(r.start) ?? []), { run: i, end: 0, dir: norm(sub(r.pts[1], r.pts[0])) }]);
    if (r.end !== null) ends.set(r.end, [...(ends.get(r.end) ?? []), { run: i, end: 1, dir: norm(sub(r.pts[n - 2], r.pts[n - 1])) }]);
  });
  const link = new Map<string, string>();
  for (const list of ends.values()) {
    const pairs: { a: number; b: number; turn: number }[] = [];
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        if (list[a].run === list[b].run) continue;
        const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(list[a].dir, list[b].dir))));
        if (turn <= maxTurn) pairs.push({ a, b, turn });
      }
    pairs.sort((x, y) => x.turn - y.turn);
    const taken = new Set<number>();
    for (const { a, b } of pairs) {
      if (taken.has(a) || taken.has(b)) continue;
      taken.add(a);
      taken.add(b);
      const ka = `${list[a].run}:${list[a].end}`;
      const kb = `${list[b].run}:${list[b].end}`;
      link.set(ka, kb);
      link.set(kb, ka);
    }
  }

  const chains: { pts: Pt[]; closed: boolean }[] = [];
  const visited = new Set<number>();
  const follow = (r0: number, enter: 0 | 1) => {
    let pts: Pt[] = [];
    let r = r0;
    let e = enter;
    let closed = false;
    while (true) {
      visited.add(r);
      const seg = e === 0 ? runs[r].pts : runs[r].pts.slice().reverse();
      pts = pts.length && dist(pts[pts.length - 1], seg[0]) < 1e-6 ? [...pts, ...seg.slice(1)] : [...pts, ...seg];
      const nxt = link.get(`${r}:${1 - e}`);
      if (!nxt) break;
      const [q, qe] = nxt.split(':').map(Number);
      if (visited.has(q)) {
        closed = q === r0;
        break;
      }
      r = q;
      e = qe as 0 | 1;
    }
    if (closed && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
    chains.push({ pts, closed });
  };
  runs.forEach((r, i) => {
    if (r.closed) {
      visited.add(i);
      chains.push({ pts: r.pts, closed: true });
    }
  });
  runs.forEach((_, i) => {
    if (visited.has(i)) return;
    if (!link.has(`${i}:0`)) follow(i, 0);
    else if (!link.has(`${i}:1`)) follow(i, 1);
  });
  runs.forEach((_, i) => !visited.has(i) && follow(i, 0));

  // Split wherever the tightest bend radius cannot fit; drop pieces shorter than the minimum.
  const strands: Strand[] = [];
  const short: Pt[][] = [];
  const bendBreaks: Pt[] = [];
  const cuts: Pt[] = [];
  const accept = (pts: Pt[], closed: boolean) => {
    const length = polylineLength(closed ? [...pts, pts[0]] : pts);
    if (pts.length < 2 || length < minLength) {
      short.push(closed ? [...pts, pts[0]] : pts);
      return;
    }
    strands.push({ pts, closed, length, d: filletPath(pts, closed, minBend) });
    if (!closed) cuts.push(pts[0], pts[pts.length - 1]);
  };
  for (const chain of chains) {
    let closed = chain.closed && chain.pts.length >= 3;
    let pts = mergeCorners(chain.pts, closed, minBend, 3 * width);
    if (closed) {
      const bad = pts.findIndex((_, i) => !bendFits(pts, i, minBend, true, clear));
      if (bad < 0) {
        accept(pts, true);
        continue;
      }
      bendBreaks.push(pts[bad]);
      pts = [...pts.slice(bad), ...pts.slice(0, bad + 1)];
      closed = false;
    }
    let start = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      if (bendFits(pts, i, minBend, false, clear)) continue;
      bendBreaks.push(pts[i]);
      accept(pts.slice(start, i + 1), false);
      start = i;
    }
    accept(pts.slice(start), false);
  }
  return { segments, strands, short, thin, bendBreaks, cuts };
}

/* ---------- 3. thin regions: where does the infill pattern stop fitting? ---------- */

export type Disk = { c: Pt; r: number };

/** Resample the axis densely; each sample with its distance to the wall is a maximal inscribed disk. */
export function axisDisks(g: Graph, d: (p: Pt) => number, step: number): Disk[] {
  const disks: Disk[] = [];
  for (const [a, b] of g.edges) {
    const pa = g.nodes[a].p;
    const pb = g.nodes[b].p;
    const n = Math.max(1, Math.ceil(dist(pa, pb) / step));
    for (let i = 0; i <= n; i++) {
      const c = lerp(pa, pb, i / n);
      disks.push({ c, r: d(c) });
    }
  }
  return disks;
}

/** Parallel infill lines clipped to the region (even–odd over all loops), one of them through `origin`. */
export function scanlines(shape: Shape, angleDeg: number, spacing: number, origin: Pt = [0, 0]): [Pt, Pt][] {
  const a = (angleDeg * Math.PI) / 180;
  const rot = (p: Pt): Pt => [p[0] * Math.cos(a) + p[1] * Math.sin(a), -p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  const back = (p: Pt): Pt => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  const rings = [shape.outer, ...shape.holes].map((r) => r.map(rot));
  const ys = rings.flat().map((p) => p[1]);
  const y0 = rot(origin)[1];
  const out: [Pt, Pt][] = [];
  for (let y = y0 + Math.ceil((Math.min(...ys) - y0) / spacing) * spacing; y < Math.max(...ys); y += spacing) {
    const xs: number[] = [];
    for (const ring of rings)
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      });
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([back([xs[i], y]), back([xs[i + 1], y])]);
  }
  return out;
}

/** Drop the parts of each infill line that fall in the thin region (disks too narrow for the pattern). */
export function fittingInfill(lines: [Pt, Pt][], thinDisks: Disk[], step = 0.3): [Pt, Pt][] {
  const thin = (p: Pt) => thinDisks.some((k) => dist(p, k.c) <= k.r);
  const out: [Pt, Pt][] = [];
  for (const [a, b] of lines) {
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    let runStart: Pt | null = null;
    for (let i = 0; i <= n; i++) {
      const p = lerp(a, b, i / n);
      if (!thin(p)) runStart ??= p;
      else if (runStart) {
        out.push([runStart, lerp(a, b, (i - 1) / n)]);
        runStart = null;
      }
    }
    if (runStart) out.push([runStart, b]);
  }
  return out.filter(([p, q]) => len(sub(q, p)) > step);
}
