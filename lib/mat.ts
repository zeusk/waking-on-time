// Approximate medial axis of a polygon with holes, after Smogavec & Žalik,
// "A fast algorithm for constructing approximate medial axis of polygons, using Steiner points",
// Advances in Engineering Software 52 (2012) 1–9:
//   1. constrained Delaunay triangulation (CDT) of the polygon,
//   2. local corrections with Steiner points: obtuse junction triangles (§2.1), convex corners (§2.2),
//   3. classify triangles A / B / C and build the axis from them (§2.3).
// One change for the slicer: the last segment of every branch, the one that runs into a convex
// corner on the wall, is dropped so a fibre laid along the axis never reaches the part's surface.
import cdt2d from 'cdt2d';
import { add, angleAt, circumcenter, cross, dist, distToSegment, mid, mul, norm, sub, type Pt } from './geometry';

export type Shape = { id: string; label: string; outer: Pt[]; holes: Pt[][] };
export type Tri = [number, number, number];
export type TriType = 'A' | 'B' | 'C';
export type Mesh = { points: Pt[]; steiner: boolean[]; segs: [number, number][]; tris: Tri[] };
export type Graph = { nodes: { p: Pt; r: number }[]; edges: [number, number][] };

export type ObtuseCheck = { tri: [Pt, Pt, Pt]; from: Pt; to: Pt; hit: Pt | null; steiner: Pt | null };
export type CornerFix = { v: Pt; radius: number; s1: Pt; s2: Pt };

export type MatResult = {
  shape: Shape;
  bbox: [number, number, number, number];
  cdt: Mesh;
  obtuse: { checks: ObtuseCheck[]; mesh: Mesh };
  convex: { corners: CornerFix[]; mesh: Mesh };
  /** Our global re-triangulation in §2.2 can re-create obtuse junction triangles, so §2.1 runs again. */
  recheck: ObtuseCheck[];
  mesh: Mesh;
  types: TriType[];
  axis: {
    /** The axis as the paper builds it, branches running all the way into convex corners. */
    polylines: Pt[][];
    /** The same axis without the segments that touch the wall: what the toolpaths use. */
    trimmed: Pt[][];
    /** The dropped segments. */
    spurs: Pt[][];
    centers: Pt[];
    midpoints: Pt[];
    corners: Pt[];
    disabled: number[];
  };
  /** Graph of the trimmed axis. */
  graph: Graph;
  distToBoundary: (p: Pt) => number;
};

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const area2 = (a: Pt, b: Pt, c: Pt) => cross(sub(b, a), sub(c, a));
const RIGHT = Math.PI / 2;

function edgesOf(t: Tri): [number, number, number][] {
  return [
    [t[0], t[1], t[2]],
    [t[1], t[2], t[0]],
    [t[2], t[0], t[1]],
  ];
}

function insidePolygon(p: Pt, points: Pt[], walls: [number, number][]) {
  let inside = false;
  for (const [a, b] of walls) {
    const A = points[a];
    const B = points[b];
    if (A[1] > p[1] !== B[1] > p[1] && A[0] + ((p[1] - A[1]) * (B[0] - A[0])) / (B[1] - A[1]) > p[0]) inside = !inside;
  }
  return inside;
}

/** CDT of the polygon. `extra` edges are forced into the triangulation without counting as walls. */
function triangulate(points: Pt[], walls: [number, number][], extra: [number, number][] = []): Tri[] {
  const tris = extra.length
    ? cdt2d(points, [...walls, ...extra], { exterior: true }).filter(([a, b, c]) =>
        insidePolygon([(points[a][0] + points[b][0] + points[c][0]) / 3, (points[a][1] + points[b][1] + points[c][1]) / 3], points, walls),
      )
    : cdt2d(points, walls, { exterior: false });
  // cdt2d does not promise an orientation; keep every triangle counter-clockwise.
  return tris.map(([a, b, c]) => (area2(points[a], points[b], points[c]) > 0 ? [a, b, c] : [a, c, b]) as Tri);
}

function segHit(p: Pt, p2: Pt, q: Pt, q2: Pt) {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(q, p), s) / den;
  const u = cross(sub(q, p), r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

function inTriangle(p: Pt, [a, b, c]: [Pt, Pt, Pt]) {
  return area2(a, b, p) >= -1e-9 && area2(b, c, p) >= -1e-9 && area2(c, a, p) >= -1e-9;
}

function wallCount(t: Tri, walls: Set<string>) {
  return edgesOf(t).filter(([a, b]) => walls.has(key(a, b))).length;
}

function splitSeg(mesh: Mesh, segIdx: number, p: Pt) {
  const [a, b] = mesh.segs[segIdx];
  const m = mesh.points.length;
  mesh.points.push(p);
  mesh.steiner.push(true);
  mesh.segs[segIdx] = [a, m];
  mesh.segs.push([m, b]);
  return m;
}

/** §2.1: obtuse triangles with three neighbours whose circumcentre falls outside the polygon. */
function fixObtuse(
  base: Mesh,
  forced: [number, number][] = [],
  protectedWalls = new Set<string>(),
): { checks: ObtuseCheck[]; mesh: Mesh } {
  const mesh: Mesh = { points: base.points.slice(), steiner: base.steiner.slice(), segs: base.segs.slice(), tris: [] };
  const walls = new Set(base.segs.map(([a, b]) => key(a, b)));
  const checks: ObtuseCheck[] = [];
  const pending = new Map<number, Pt>(); // segment index → Steiner point

  for (const t of base.tris) {
    if (wallCount(t, walls) !== 0) continue;
    const P = t.map((i) => base.points[i]) as [Pt, Pt, Pt];
    const k = [0, 1, 2].find((i) => angleAt(P[i], P[(i + 1) % 3], P[(i + 2) % 3]) > RIGHT);
    if (k === undefined) continue;
    const O = P[k];
    const c = circumcenter(P[0], P[1], P[2]);

    // First polygon edge crossed by the ray from the obtuse vertex to the circumcentre.
    let best: { s: number; t: number } | null = null;
    base.segs.forEach(([a, b], s) => {
      if (a === t[k] || b === t[k]) return;
      const h = segHit(O, c, base.points[a], base.points[b]);
      if (h && h.t > 1e-9 && (!best || h.t < best.t)) best = { s, t: h.t };
    });
    if (!best) {
      checks.push({ tri: P, from: O, to: c, hit: null, steiner: null });
      continue;
    }
    const { s, t: tHit } = best as { s: number; t: number };
    const [ea, eb] = base.segs[s];
    const hit = add(O, mul(sub(c, O), tHit));
    // V: the obtuse triangle's vertex lying on the hit edge. W: its remaining vertex.
    const v = [ea, eb].find((i) => t.includes(i));
    let steiner: Pt | null = null;
    if (v !== undefined) {
      const w = t.find((i) => i !== t[k] && i !== v)!;
      const M = mid(O, base.points[w]);
      // The line through the circumcentre and the midpoint of edge O–W, cut with the hit edge.
      const far = add(M, mul(sub(c, M), 1e3));
      const nearSide = add(M, mul(sub(c, M), -1e3));
      const h = segHit(nearSide, far, base.points[ea], base.points[eb]);
      if (h && h.u > 0.05 && h.u < 0.95 && !pending.has(s) && !protectedWalls.has(key(ea, eb))) {
        steiner = add(base.points[ea], mul(sub(base.points[eb], base.points[ea]), h.u));
        pending.set(s, steiner);
      }
    }
    checks.push({ tri: P, from: O, to: c, hit, steiner });
  }

  if (!pending.size) return { checks, mesh: base };
  for (const [s, p] of pending) splitSeg(mesh, s, p);
  mesh.tris = triangulate(mesh.points, mesh.segs, forced);
  return { checks, mesh };
}

/**
 * §2.2: every convex vertex gets two Steiner points on its walls, at half the distance to the
 * nearest vertex of its triangle fan, and a small isosceles ear (type B) between them. All corner
 * points are computed from the same triangulation first (so neighbouring corners can share one,
 * as in the paper's Fig. 7f), then the polygon is re-triangulated with each ear's edge forced.
 */
function fixConvex(
  base: Mesh,
  originalCount: number,
): { corners: CornerFix[]; mesh: Mesh; ears: [number, number][]; legs: Set<string> } {
  const P = base.points;
  const splits = new Map<number, number[]>(); // wall index → split parameters along it
  const planned: { v: number; radius: number; at: [number, number][] }[] = [];

  for (let v = 0; v < originalCount; v++) {
    const fan = base.tris.filter((t) => t.includes(v));
    const corner = fan.reduce((sum, t) => {
      const j = t.indexOf(v);
      return sum + angleAt(P[v], P[t[(j + 1) % 3]], P[t[(j + 2) % 3]]);
    }, 0);
    if (!fan.length || corner >= Math.PI - 1e-6) continue; // reflex or straight: no branch starts here
    const radius = Math.min(...fan.flatMap((t) => t.filter((i) => i !== v).map((i) => dist(P[v], P[i]))));
    const walls = base.segs.flatMap((s, i) => (s[0] === v || s[1] === v ? [i] : []));
    if (walls.length !== 2) continue;
    const at = walls.map((i): [number, number] => {
      const [a, b] = base.segs[i];
      const t = radius / 2 / dist(P[a], P[b]);
      return [i, a === v ? t : 1 - t];
    });
    for (const [i, t] of at) splits.set(i, [...(splits.get(i) ?? []), t]);
    planned.push({ v, radius, at });
  }

  const mesh: Mesh = { points: P.slice(), steiner: base.steiner.slice(), segs: [], tris: [] };
  const pointAt = new Map<string, number>(); // `${wall}:${t}` → point index
  base.segs.forEach(([a, b], i) => {
    const ts = [...new Set((splits.get(i) ?? []).map((t) => +t.toFixed(9)))].filter((t) => t > 1e-6 && t < 1 - 1e-6);
    ts.sort((x, y) => x - y);
    let prev = a;
    for (const t of ts) {
      const m = mesh.points.length;
      mesh.points.push(add(P[a], mul(sub(P[b], P[a]), t)));
      mesh.steiner.push(true);
      pointAt.set(`${i}:${t}`, m);
      mesh.segs.push([prev, m]);
      prev = m;
    }
    mesh.segs.push([prev, b]);
  });
  const indexOf = (i: number, t: number) =>
    t >= 1 - 1e-6 ? base.segs[i][1] : t <= 1e-6 ? base.segs[i][0] : pointAt.get(`${i}:${+t.toFixed(9)}`)!;

  const corners: CornerFix[] = [];
  const ears: [number, number][] = [];
  const legs = new Set<string>();
  for (const { v, radius, at } of planned) {
    const [s1, s2] = at.map(([i, t]) => indexOf(i, t));
    ears.push([s1, s2]);
    legs.add(key(v, s1)).add(key(v, s2));
    corners.push({ v: P[v], radius, s1: mesh.points[s1], s2: mesh.points[s2] });
  }

  mesh.tris = triangulate(mesh.points, mesh.segs);
  const has = new Set(mesh.tris.flatMap((t) => edgesOf(t).map(([a, b]) => key(a, b))));
  const missing = ears.filter(([a, b]) => !has.has(key(a, b)));
  if (missing.length) mesh.tris = triangulate(mesh.points, mesh.segs, missing);
  return { corners, mesh, ears: missing, legs };
}

/** §2.3: walk from every C triangle through chains of A triangles to the next C or B triangle. */
function buildAxis(mesh: Mesh, types: TriType[]) {
  const P = mesh.points;
  const walls = new Set(mesh.segs.map(([a, b]) => key(a, b)));
  const corner = (t: Tri): [Pt, Pt, Pt] => [P[t[0]], P[t[1]], P[t[2]]];

  const nbrs = new Map<string, number[]>();
  mesh.tris.forEach((t, i) => {
    for (const [a, b] of edgesOf(t)) {
      if (walls.has(key(a, b))) continue;
      nbrs.set(key(a, b), [...(nbrs.get(key(a, b)) ?? []), i]);
    }
  });
  const across = (i: number) =>
    edgesOf(mesh.tris[i])
      .filter(([a, b]) => !walls.has(key(a, b)))
      .map(([a, b]) => ({ to: nbrs.get(key(a, b))!.find((j) => j !== i), edge: [a, b] as [number, number] }))
      .filter((n): n is { to: number; edge: [number, number] } => n.to !== undefined);

  const centers = new Map<number, Pt>();
  const disabled = new Set<number>();
  mesh.tris.forEach((t, i) => {
    if (types[i] !== 'C') return;
    const tp = corner(t);
    const c = circumcenter(...tp);
    centers.set(i, c);
    const k = [0, 1, 2].find((j) => angleAt(tp[j], tp[(j + 1) % 3], tp[(j + 2) % 3]) > RIGHT);
    if (k === undefined) return;
    // Obtuse C: A triangles pierced by the vector from the obtuse vertex to the circumcentre drop out.
    for (let s = 1; s <= 24; s++) {
      const q = add(tp[k], mul(sub(c, tp[k]), s / 24));
      mesh.tris.forEach((u, j) => {
        if (types[j] === 'A' && inTriangle(q, corner(u))) disabled.add(j);
      });
    }
  });

  const top = (i: number) => {
    const count = new Map<number, number>();
    for (const [a, b] of edgesOf(mesh.tris[i])) {
      if (!walls.has(key(a, b))) continue;
      count.set(a, (count.get(a) ?? 0) + 1);
      count.set(b, (count.get(b) ?? 0) + 1);
    }
    return P[[...count].find(([, n]) => n === 2)![0]];
  };

  const polylines: Pt[][] = [];
  const trimmed: Pt[][] = [];
  const spurs: Pt[][] = [];
  const midpoints: Pt[] = [];
  const corners: Pt[] = [];
  const doneA = new Set<number>();
  const doneCC = new Set<string>();

  const walk = (from: number, first: { to: number; edge: [number, number] }, fromPt: Pt) => {
    const line: Pt[] = [fromPt];
    let prev = from;
    let cur = first.to;
    while (types[cur] === 'A') {
      if (doneA.has(cur)) return;
      doneA.add(cur);
      const next = across(cur).find((n) => n.to !== prev);
      if (!next) return;
      if (!disabled.has(cur)) {
        const m = mid(P[next.edge[0]], P[next.edge[1]]);
        line.push(m);
        midpoints.push(m);
      }
      prev = cur;
      cur = next.to;
    }
    if (types[cur] === 'B') {
      // A contributions between the last C and a B are discarded: straight to the convex corner.
      const tip = top(cur);
      corners.push(tip);
      const full = types[from] === 'C' ? [fromPt, tip] : [...line, tip];
      polylines.push(full);
      // Drop the segment into the corner, and the one out of the start corner on a C-less walk.
      const fromCorner = types[from] === 'B';
      const kept = full.slice(fromCorner ? 1 : 0, -1);
      if (kept.length > 1) trimmed.push(kept);
      if (fromCorner && full.length > 2) spurs.push(full.slice(0, 2));
      spurs.push(full.slice(-2));
      return;
    }
    if (line.length === 1) {
      const k = key(from, cur);
      if (doneCC.has(k)) return;
      doneCC.add(k);
    }
    polylines.push([...line, centers.get(cur)!]);
    trimmed.push([...line, centers.get(cur)!]);
  };

  mesh.tris.forEach((_, i) => {
    if (types[i] !== 'C') return;
    for (const n of across(i)) walk(i, n, centers.get(i)!);
  });
  // Fallback for regions with no C triangle at all (e.g. a single sleeve between two corners).
  mesh.tris.forEach((_, i) => {
    if (types[i] !== 'B' || centers.size) return;
    for (const n of across(i)) walk(i, n, top(i));
  });

  return { polylines, trimmed, spurs, centers: [...centers.values()], midpoints, corners, disabled: [...disabled] };
}

function toGraph(polylines: Pt[][], d: (p: Pt) => number): Graph {
  const nodes: Graph['nodes'] = [];
  const ids = new Map<string, number>();
  const edges = new Map<string, [number, number]>();
  const id = (p: Pt) => {
    const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
    if (!ids.has(k)) {
      ids.set(k, nodes.length);
      nodes.push({ p, r: d(p) });
    }
    return ids.get(k)!;
  };
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const a = id(line[i - 1]);
      const b = id(line[i]);
      if (a !== b) edges.set(key(a, b), [a, b]);
    }
  }
  return { nodes, edges: [...edges.values()] };
}

export function medialAxis(shape: Shape): MatResult {
  const points: Pt[] = [];
  const segs: [number, number][] = [];
  for (const ring of [shape.outer, ...shape.holes]) {
    const start = points.length;
    ring.forEach((p, i) => {
      points.push(p);
      segs.push([start + i, start + ((i + 1) % ring.length)]);
    });
  }
  const boundary = segs.map(([a, b]) => [points[a], points[b]] as [Pt, Pt]);
  const distToBoundary = (p: Pt) => Math.min(...boundary.map(([a, b]) => distToSegment(p, a, b)));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const bbox: MatResult['bbox'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

  const cdt: Mesh = { points, steiner: points.map(() => false), segs, tris: triangulate(points, segs) };
  const obtuse = fixObtuse(cdt);
  const convex = fixConvex(obtuse.mesh, points.length);
  let mesh = convex.mesh;
  const recheck: ObtuseCheck[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const again = fixObtuse(mesh, convex.ears, convex.legs);
    recheck.push(...again.checks.filter((c) => c.steiner));
    if (again.mesh === mesh) break;
    mesh = again.mesh;
  }
  const walls = new Set(mesh.segs.map(([a, b]) => key(a, b)));
  const types = mesh.tris.map((t): TriType => {
    const n = wallCount(t, walls);
    return n === 1 ? 'A' : n === 0 ? 'C' : 'B';
  });
  const axis = buildAxis(mesh, types);
  return {
    shape,
    bbox,
    cdt,
    obtuse,
    convex: { corners: convex.corners, mesh: convex.mesh },
    recheck,
    mesh,
    types,
    axis,
    graph: toGraph(axis.trimmed, distToBoundary),
    distToBoundary,
  };
}
