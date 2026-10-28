// Layer regions a slicer typically meets, in millimetres (y grows downward, as in SVG).
import { circle, type Pt } from './geometry';
import type { Shape } from './mat';

export const SHAPES: Shape[] = [
  {
    id: 'channel',
    label: 'C-channel',
    // Thin-walled section: one long sleeve with two inner and four outer corners.
    outer: [
      [0, 0],
      [80, 0],
      [80, 8],
      [8, 8],
      [8, 50],
      [80, 50],
      [80, 58],
      [0, 58],
    ],
    holes: [],
  },
  {
    id: 'bracket',
    label: 'Bracket',
    // L-bracket with two bolt holes: the axis loops around each hole.
    outer: [
      [0, 0],
      [110, 0],
      [110, 26],
      [30, 26],
      [30, 76],
      [0, 76],
    ],
    holes: [circle(15, 61, 6.5, 16).reverse(), circle(95, 13, 6.5, 16).reverse()],
  },
  {
    id: 'rib',
    label: 'Tapered rib',
    // A stiffening rib that narrows from 14 mm to about 1.2 mm, with one bend.
    outer: [
      [0, 23],
      [60.3, 26],
      [124.3, 7.4],
      [124.7, 8.6],
      [61.7, 34],
      [0, 37],
    ] as Pt[],
    holes: [],
  },
  {
    id: 'cross',
    label: 'Cross',
    // Connector with arms of different widths: junction triangles in the middle.
    outer: [
      [0, 30],
      [44, 30],
      [44, 0],
      [56, 0],
      [56, 30],
      [100, 30],
      [100, 48],
      [56, 48],
      [56, 80],
      [44, 80],
      [44, 48],
      [0, 48],
    ],
    holes: [],
  },
];

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id)!;
