/**
 * Industry & exploration demos: one small model shared by the WebGL scene and the
 * Canvas fallback. Each demo is a terrain, a usual route, a detour and the hazard
 * that makes the machine change its mind. Driven by chapter progress `p`.
 */
import { createNoise2D, fbm } from './noise';

export type V2 = [number, number];
export type FieldId = 'haul' | 'inspect' | 'rover';
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
  /** Whether the hazard blocks the usual route, or is something to look at more closely. */
  blocked: boolean;
  /** Equipment on site, shared by the map heights and the machine view. */
  props?: Prop[];
}

export interface Prop {
  kind: 'pump' | 'tank' | 'rack' | 'skid';
  x: number;
  z: number;
  /** Footprint along x and z (tanks: diameter in w). */
  w: number;
  d: number;
  h: number;
  hot?: boolean;
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

/* ---------- open-pit haulage: a benched haul road from the shovel to the dump ---------- */
function haul(): FieldDemo {
  const n1 = createNoise2D(31);
  const n2 = createNoise2D(47);
  const n3 = createNoise2D(13);
  const main: V2[] = [[27, 60], [27, 50], [27, 42], [27, 36]];
  const planned: V2[] = [[27, 36], [27, 26], [27, 16], [27, 6]];
  const detour: V2[] = [[27, 36], [30.5, 32], [32.5, 26], [32.5, 20], [30, 14], [27, 9], [27, 6]];
  const hz: V2 = [27, 27];
  /* The haul road is a bench cut into the pit wall: benches climb on the left, the pit drops away on the right. */
  const parts = (x: number, z: number) => {
    const e = x + fbm(n2, z * 0.06, 0.5, 2) * 1.6;
    let y = (z - 30) * 0.05;
    for (let k = 0; k < 4; k++) {
      const c = 22 - 5.5 * k + fbm(n1, z * 0.09, k * 3.1, 2) * 1.4;
      y += 4.2 * (1 - sstep(c - 1.5, c, e));
      y += 0.7 * Math.max(0, 0.5 + fbm(n3, z * 0.35, k * 5.3, 2)) * Math.exp(-(((e - c - 0.4) / 0.8) ** 2));
    }
    for (let k = 0; k < 3; k++) {
      const c = 38.6 + 6.5 * k + fbm(n1, z * 0.08, 9 + k * 2.7, 2) * 1.3;
      y -= 4.6 * sstep(c, c + 1.7, e);
      y += 0.55 * Math.max(0, 0.5 + fbm(n3, z * 0.3, 20 + k * 4.1, 2)) * Math.exp(-(((e - c - 2.1) / 0.9) ** 2));
    }
    /* safety berm along the crest of the drop */
    y += 0.75 * (0.75 + 0.35 * fbm(n3, z * 0.4, 3.3, 2)) * Math.exp(-(((e - 37.7) / 0.55) ** 2));
    const road = sstep(22.6, 23.6, e) * (1 - sstep(36.4, 37.3, e));
    y += fbm(n1, x * 0.9, z * 0.9, 3) * (0.04 + 0.32 * (1 - road)) + fbm(n2, x * 0.3, z * 0.3, 2) * 0.12;
    /* a fresh scar in the wall above, and the fan of rock it shed onto the road */
    const scar = Math.exp(-(((z - hz[1]) / 2.6) ** 2)) * sstep(8, 13, e) * (1 - sstep(19, 21.6, e));
    y -= 1.5 * scar;
    const fan = sstep(18.5, 21.5, e) * (1 - sstep(27.4, 30, e)) * Math.exp(-(((z - hz[1]) / (2 + Math.max(0, e - 21) * 0.38)) ** 2));
    y += fan * (0.3 + 0.6 * Math.max(0, fbm(n1, x * 1.4, z * 1.4, 2) + 0.35));
    return { y, e, road, scar, fan };
  };
  const height = (x: number, z: number) => parts(x, z).y;
  return {
    id: 'haul', extent: 60, main, planned, detour, mapTop: 18, sensor: 14, hazardAt: hz, blocked: true,
    hazards: [{ x: hz[0], z: hz[1], r: 3.6, color: AMBER }],
    height,
    color(x, z) {
      const { y, e, road, scar, fan } = parts(x, z);
      const q = 0.35;
      const slope = Math.hypot(height(x + q, z) - height(x - q, z), height(x, z + q) - height(x, z - q)) / (2 * q);
      const g = 0.36 + fbm(n2, x * 1.4, z * 1.4, 2) * 0.06;
      const band = 0.05 * Math.sin(y * 2.3 + fbm(n1, x * 0.2, z * 0.2, 2) * 2.5);
      const face: RGB = [0.44 + band, 0.34 + band * 0.9, 0.27 + band * 0.7];
      const top: RGB = [g * 1.25, g * 1.04, g * 0.8];
      const rut = Math.min(...[26.1, 27.9, 31.6, 33.4].map((l) => Math.abs(e - l))) < 0.28 ? 0.9 : 1;
      const lane: RGB = [g * 1.38 * rut, g * 1.24 * rut, g * 1.06 * rut];
      const t = sstep(0.55, 1.1, slope);
      let c: RGB = [0, 1, 2].map((i) => {
        const flat = top[i] + (lane[i] - top[i]) * road;
        return flat + (face[i] - flat) * t;
      }) as RGB;
      const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      c = mix(c, [0.58, 0.48, 0.38], Math.min(1, scar * 0.8));
      c = mix(c, [0.3, 0.26, 0.22], Math.min(1, fan * 0.7));
      return c;
    },
  };
}

/* ---------- industrial inspection: a night round past pumps, tanks and pipe racks ---------- */
const INSPECT_PROPS: Prop[] = [
  { kind: 'pump', x: 25.5, z: 25.5, w: 2.6, d: 1.4, h: 1.3 },
  { kind: 'pump', x: 33.5, z: 25.5, w: 2.6, d: 1.4, h: 1.3, hot: true },
  { kind: 'pump', x: 47, z: 23.6, w: 2.6, d: 1.4, h: 1.3 },
  { kind: 'tank', x: 32, z: 40, w: 6, d: 6, h: 5 },
  { kind: 'tank', x: 41, z: 37.5, w: 5, d: 5, h: 4.4 },
  { kind: 'rack', x: 38, z: 18, w: 36, d: 1.2, h: 3.2 },
  { kind: 'skid', x: 24, z: 46, w: 4, d: 3, h: 1.8 },
  { kind: 'skid', x: 6, z: 40, w: 3, d: 3, h: 1.6 },
  { kind: 'skid', x: 52, z: 32, w: 3.5, d: 2.5, h: 1.8 },
];
function inspect(): FieldDemo {
  const n1 = createNoise2D(53);
  const main: V2[] = [[8, 56], [11, 47], [15, 39], [21, 33]];
  const planned: V2[] = [[21, 33], [30, 30.5], [40, 28], [52, 25]];
  const detour: V2[] = [[21, 33], [27, 29.5], [29.5, 25.5], [32, 22.6], [35.5, 22.6], [38.5, 25], [42, 27.5], [52, 25]];
  const walk = [main, planned].map((c) => catmull(c));
  const hz: V2 = [33.5, 25.5];
  const props = INSPECT_PROPS;
  return {
    id: 'inspect', extent: 60, main, planned, detour, mapTop: 5, sensor: 12, hazardAt: hz, blocked: false, props,
    hazards: [{ x: hz[0], z: hz[1], r: 2.4, color: AMBER }],
    height(x, z) {
      let y = fbm(n1, x * 0.2, z * 0.2, 2) * 0.04;
      for (const q of props) {
        const inside = q.kind === 'tank'
          ? Math.hypot(x - q.x, z - q.z) < q.w / 2
          : Math.abs(x - q.x) < q.w / 2 && Math.abs(z - q.z) < q.d / 2;
        if (inside) y = Math.max(y, q.h);
      }
      return y;
    },
    color(x, z, y) {
      const dd = Math.min(...walk.map((p) => distTo(p, x, z)));
      const g = 0.16 + fbm(n1, x * 2, z * 2, 2) * 0.03;
      if (y > 0.5) return [0.3, 0.33, 0.37];
      if (dd < 1.2) return [0.34, 0.34, 0.33];
      if (dd < 1.45) return [0.72, 0.58, 0.16];
      return [g, g * 1.02, g * 1.06];
    },
  };
}

/* ---------- planetary rover: from the lander to a target rock, minutes from Earth ---------- */
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
    id: 'rover', extent: 60, main, planned, detour, mapTop: 3.2, sensor: 16, hazardAt: hz, blocked: true,
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

export const FIELD_DEMOS: Record<FieldId, () => FieldDemo> = { haul, inspect, rover };

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
