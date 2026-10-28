declare module 'cdt2d' {
  /** Constrained Delaunay triangulation (https://github.com/mikolalysenko/cdt2d). Returns index triples. */
  export default function cdt2d(
    points: [number, number][],
    edges?: [number, number][],
    options?: { delaunay?: boolean; interior?: boolean; exterior?: boolean; infinity?: boolean },
  ): [number, number, number][];
}
