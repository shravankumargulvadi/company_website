/**
 * Industry & exploration demos: one small model shared by the WebGL scene and the
 * Canvas fallback. Each demo is a terrain, a usual route, a detour and the hazard
 * that makes the machine change its mind. Driven by chapter progress `p`.
 */
import { createNoise2D, fbm } from './noise';

export type V2 = [number, number];
export type FieldId = 'mine' | 'patrol' | 'rover';
export type RGB = [number, number, number];

export interface Hazard {
  x: number;
  z: number;
  r: number;
  color: RGB;
  /** Shown from the start (e.g. dust) rather than once detected. */
  always?: boolean;
}

export interface FieldDemo {
  id: FieldId;
  extent: number;
  main: V2[];
  planned: V2[];
  detour: V2[];
  height(x: number, z: number): number;
  color(x: number, z: number, y: number): RGB;
  /** Height that maps to the brightest map shade. */
  mapTop: number;
  sensor: number;
  hazards: Hazard[];
  /** Point on the planned route that the hazard label anchors to. */
  hazardAt: V2;
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function catmull(ctrl: V2[], step = 0.5): V2[] {
  const c = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: V2[] = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const f = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

export function distTo(poly: V2[], x: number, z: number) {
  let best = 1e9;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

/** Arc-length parameterised polyline. */
export class Path2 {
  cum: number[] = [0];
  length: number;
  constructor(public pts: V2[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }
  at(d: number): V2 {
    d = Math.min(this.length, Math.max(0, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const t = (d - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    const [a, b] = [this.pts[i - 1], this.pts[i]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  heading(d: number) {
    const a = this.at(d - 0.6);
    const b = this.at(d + 0.6);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
}

export interface FieldRoutes {
  main: V2[];
  planned: V2[];
  detour: V2[];
  /** The route actually driven: main, then the detour. */
  track: Path2;
  /** Fraction of the track at which the routes fork. */
  fork: number;
}

export function fieldRoutes(d: FieldDemo): FieldRoutes {
  const main = catmull(d.main);
  const planned = catmull(d.planned);
  const detour = catmull(d.detour);
  const mainLen = new Path2(main).length;
  const track = new Path2([...main, ...detour.slice(1)]);
  return { main, planned, detour, track, fork: mainLen / track.length };
}

export interface FieldMoment {
  /** Fraction of the driven track. */
  s: number;
  detect: number;
  decided: number;
  done: number;
}

/** Approach the fork, hold while the hazard is weighed, then take the detour. */
export function fieldMoment(p: number, fork: number): FieldMoment {
  const r = (a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
  const hold = fork * 0.94;
  const s = p < 0.3 ? r(0.02, 0.3) * hold : p < 0.5 ? hold : hold + (1 - hold) * r(0.5, 0.95);
  return { s, detect: sstep(0.27, 0.34, p), decided: sstep(0.44, 0.5, p), done: sstep(0.9, 0.96, p) };
}

/** For each grid point, the track fraction at which it first comes within sensor range. */
export function seenField(d: FieldDemo, track: Path2, xs: Float32Array, zs: Float32Array) {
  const N = 260;
  const samples = Array.from({ length: N + 1 }, (_, i) => track.at((i / N) * track.length));
  const out = new Float32Array(xs.length);
  const r2 = d.sensor * d.sensor;
  for (let k = 0; k < xs.length; k++) {
    let seen = 2;
    for (let i = 0; i <= N; i++) {
      const dx = xs[k] - samples[i][0];
      const dz = zs[k] - samples[i][1];
      if (dx * dx + dz * dz < r2) { seen = i / N; break; }
    }
    out[k] = seen;
  }
  return out;
}

const AMBER: RGB = [1, 0.55, 0.16];
const VIOLET: RGB = [0.62, 0.45, 1];

/* ---------- underground mine: a fresh heading after the blast ---------- */
function mine(): FieldDemo {
  const n1 = createNoise2D(31);
  const n2 = createNoise2D(47);
  const main: V2[] = [[30, 60], [30.5, 50], [29.5, 40], [30, 33]];
  const planned: V2[] = [[30, 33], [29.5, 24], [30.5, 15], [30, 6]];
  const detour: V2[] = [[30, 33], [37, 31], [41, 24], [40, 15], [35, 8], [30.5, 6]];
  const polys = [main, planned, detour].map((c) => catmull(c));
  const hz: V2 = [30, 27];
  return {
    id: 'mine', extent: 60, main, planned, detour, mapTop: 3.8, sensor: 10, hazardAt: hz,
    hazards: [
      { x: hz[0], z: hz[1], r: 5.5, color: AMBER },
      { x: 29, z: 19, r: 7, color: VIOLET, always: true },
    ],
    height(x, z) {
      const dd = Math.min(...polys.map((p) => distTo(p, x, z)));
      const wall = sstep(1.6, 2.7, dd + fbm(n2, x * 0.4, z * 0.4, 2) * 0.45);
      const rubble = Math.max(0, fbm(n1, x * 1.4, z * 1.4, 2)) * 0.5 * Math.exp(-((x - hz[0]) ** 2 + (z - hz[1]) ** 2) / 14);
      return 3.8 * wall + wall * fbm(n1, x * 0.3, z * 0.3, 3) * 0.7 + fbm(n1, x * 0.9, z * 0.9, 2) * 0.08 + rubble * (1 - wall);
    },
    color(x, z, y) {
      const g = 0.2 + 0.06 * Math.min(1, y / 3.6) + fbm(n2, x * 1.6, z * 1.6, 2) * 0.05;
      const floor = 1 - Math.min(1, y / 1.2);
      return [g * 1.18 + floor * 0.05, g * 1.02 + floor * 0.04, g * 0.86 + floor * 0.02];
    },
  };
}

/* ---------- legged patrol: an industrial site at night ---------- */
function patrol(): FieldDemo {
  const n1 = createNoise2D(53);
  const main: V2[] = [[12, 58], [14, 48], [20, 40], [30, 36]];
  const planned: V2[] = [[30, 36], [38, 30], [44, 22], [47, 10]];
  const detour: V2[] = [[30, 36], [30, 26], [33, 16], [40, 9], [47, 7]];
  const polys = [main, planned, detour].map((c) => catmull(c));
  const hz: V2 = [40, 27];
  return {
    id: 'patrol', extent: 60, main, planned, detour, mapTop: 4, sensor: 15, hazardAt: hz,
    hazards: [{ x: hz[0], z: hz[1], r: 4.5, color: AMBER }],
    height(x, z) {
      const dd = Math.min(...polys.map((p) => distTo(p, x, z)));
      const bx = ((x % 9) + 9) % 9;
      const bz = ((z % 9) + 9) % 9;
      const inBlock = bx > 1.5 && bx < 7.5 && bz > 1.5 && bz < 7.5 && dd > 2.6;
      const tall = 2.2 + 1.8 * (0.5 + 0.5 * n1(Math.floor(x / 9) * 3.1, Math.floor(z / 9) * 3.1));
      return (inBlock ? tall : 0) + fbm(n1, x * 0.2, z * 0.2, 2) * 0.04;
    },
    color(x, z, y) {
      const dd = Math.min(...polys.map((p) => distTo(p, x, z)));
      const g = 0.16 + fbm(n1, x * 2, z * 2, 2) * 0.03;
      if (y > 1) return [0.3, 0.33, 0.37];
      if (dd < 1.4) return [0.36, 0.36, 0.35];
      if (dd < 1.6) return [0.72, 0.58, 0.16];
      return [g, g * 1.02, g * 1.06];
    },
  };
}

/* ---------- planetary rover: craters, minutes from Earth ---------- */
export const ROVER_CRATERS: [number, number, number, number][] = [
  [37, 25, 8, 2.6], [11, 18, 4, 1.2], [46, 48, 6, 1.8], [12, 40, 3.5, 1], [50, 12, 4, 1.2],
];
function rover(): FieldDemo {
  const n1 = createNoise2D(71);
  const n2 = createNoise2D(89);
  const main: V2[] = [[24, 60], [26, 50], [27, 42], [28, 36]];
  const planned: V2[] = [[28, 36], [30, 27], [31, 18], [33, 6]];
  const detour: V2[] = [[28, 36], [22, 30], [21, 20], [25, 11], [33, 6]];
  const hz: V2 = [30.2, 24.5];
  return {
    id: 'rover', extent: 60, main, planned, detour, mapTop: 3.2, sensor: 16, hazardAt: hz,
    hazards: [{ x: hz[0], z: hz[1], r: 5, color: AMBER }],
    height(x, z) {
      let y = fbm(n1, x * 0.05, z * 0.05, 4) * 1.6 + fbm(n2, x * 0.4, z * 0.4, 2) * 0.12;
      for (const [cx, cz, r, depth] of ROVER_CRATERS) {
        const d = Math.hypot(x - cx, z - cz) / r;
        y += d < 1 ? -depth * (1 - d * d) : 0;
        y += depth * 0.45 * Math.exp(-(((d - 1) / 0.28) ** 2));
      }
      return y;
    },
    color(x, z, y) {
      const g = 0.42 + y * 0.03 + fbm(n2, x * 1.2, z * 1.2, 3) * 0.06;
      const soft = Math.exp(-((x - hz[0]) ** 2 + (z - hz[1]) ** 2) / 10) * 0.12;
      return [g * 1.06 + soft, g * 0.98 + soft * 0.9, g * 0.9 + soft * 0.7];
    },
  };
}

export const FIELD_DEMOS: Record<FieldId, () => FieldDemo> = { mine, patrol, rover };

export interface FieldGrid {
  R: number;
  xs: Float32Array;
  zs: Float32Array;
  ys: Float32Array;
  risk: Float32Array;
  haz: Float32Array;
  unc: Float32Array;
  seen: Float32Array;
  color: Float32Array;
}

/** (R+1)² samples of height, terrain risk, hazards and when each point is first seen. */
export function fieldGrid(d: FieldDemo, r: FieldRoutes, R: number): FieldGrid {
  const n = (R + 1) * (R + 1);
  const g: FieldGrid = {
    R, xs: new Float32Array(n), zs: new Float32Array(n), ys: new Float32Array(n), risk: new Float32Array(n),
    haz: new Float32Array(n), unc: new Float32Array(n), seen: new Float32Array(n), color: new Float32Array(n * 3),
  };
  const e = 0.35;
  for (let j = 0, k = 0; j <= R; j++) {
    for (let i = 0; i <= R; i++, k++) {
      const x = (i / R) * d.extent;
      const z = (j / R) * d.extent;
      const y = d.height(x, z);
      g.xs[k] = x; g.zs[k] = z; g.ys[k] = y;
      const slope = Math.hypot(d.height(x + e, z) - d.height(x - e, z), d.height(x, z + e) - d.height(x, z - e)) / (2 * e);
      g.risk[k] = Math.min(1, slope * 0.8 + Math.max(0, y / d.mapTop) * 0.25);
      for (const h of d.hazards) {
        const v = Math.exp(-((x - h.x) ** 2 + (z - h.z) ** 2) / (h.r * h.r * 0.5));
        if (h.always) g.unc[k] = Math.max(g.unc[k], v);
        else g.haz[k] = Math.max(g.haz[k], v);
      }
      const c = d.color(x, z, y);
      g.color.set(c, k * 3);
    }
  }
  g.seen = seenField(d, r.track, g.xs, g.zs);
  return g;
}
