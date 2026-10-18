/**
 * Confined-passage model (cave / tunnel / culvert) used by Candidate A's
 * underground chapter and the passage proof placeholder.
 *
 * Deterministic: an entry tunnel to a fork, a short straight branch with a drop
 * and rubble in it, and a long low-risk detour that the rover takes; a 360°
 * range sensor with occlusion; and a
 * 2.5D elevation / risk grid whose cells record where along the path they
 * were first seen and where they were seen best. Rendering code only compares
 * those values against the current path distance, so scrubbing is free.
 */
import { createNoise2D, fbm, mulberry32 } from './noise';
import { smoothstep } from './world';

export interface PassagePose {
  x: number;
  z: number;
  y: number;
  heading: number;
  s: number;
}

export interface Passage {
  /** Side length of the square area, metres. World x/z run 0..extent. */
  extent: number;
  /** Fine raster (FPV surfaces): res × res, index j * res + i, x = i / (res - 1) * extent. */
  res: number;
  floor: Float32Array;
  ceil: Float32Array;
  /** Map grid: n × n cells of `cell` metres, index j * n + i, centre x = (i + 0.5) * cell. */
  n: number;
  cell: number;
  height: Float32Array;
  risk: Float32Array;
  open: Uint8Array;
  /** First observation (path distance, range) and closest observation. Infinity = never seen. */
  s1: Float32Array;
  r1: Float32Array;
  s2: Float32Array;
  r2: Float32Array;
  path: PassagePose[];
  ds: number;
  length: number;
  range: number;
  base: number;
  wallTop: number;
  /** Path distance at the fork. */
  junction: number;
  /** The short, straight branch from the fork to the goal (not driven). */
  direct: { x: number; z: number; y: number }[];
  directLen: number;
  detourLen: number;
}

export interface PassageOptions {
  res?: number;
  n?: number;
  seed?: number;
}

const TAU = Math.PI * 2;
const sat = (v: number) => Math.min(1, Math.max(0, v));

interface Seg {
  ax: number; az: number; bx: number; bz: number;
  wa: number; wb: number;
}

type Pt = { x: number; z: number };

/** Uniform Catmull-Rom through `ctrl`, resampled roughly every `step` metres. */
function spline(ctrl: [number, number][], step = 0.25): Pt[] {
  const c = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: Pt[] = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const last = ctrl[ctrl.length - 1];
  out.push({ x: last[0], z: last[1] });
  return out;
}

const polyLen = (p: Pt[]) => p.slice(1).reduce((acc, q, i) => acc + Math.hypot(q.x - p[i].x, q.z - p[i].z), 0);

export function createPassage(opts: PassageOptions = {}): Passage {
  const { res = 224, n = 96, seed = 7 } = opts;
  const E = 30;
  const wallTop = 2.4;
  const range = 7;
  const nA = createNoise2D(seed);
  const nB = createNoise2D(seed + 11);
  const nF = createNoise2D(seed + 23);
  const nR = createNoise2D(seed + 37);
  const rnd = mulberry32(seed + 5);

  /* an entry tunnel reaches a fork: a short straight branch to the goal
     chamber (with a drop and rubble in it), and a long winding detour */
  const J: Pt = { x: 9.5, z: 19 };
  const G: Pt = { x: 21.5, z: 12.5 };
  const entry = spline([[3.2, 26.8], [5.2, 24.6], [7.6, 21.6], [J.x, J.z]]);
  const detour = spline([
    [J.x, J.z], [7.4, 15.5], [7.2, 11.5], [9.2, 7.2], [13.5, 4.6], [18.5, 4.0], [23, 5.4], [25.2, 8.6], [24.4, 11.6], [G.x, G.z],
  ]);
  const dLen = Math.hypot(G.x - J.x, G.z - J.z);
  const ux = (G.x - J.x) / dLen;
  const uz = (G.z - J.z) / dLen;
  const direct: Pt[] = [];
  for (let d = 0; d <= dLen + 1e-6; d += 0.25) direct.push({ x: J.x + ux * d, z: J.z + uz * d });

  const segs: Seg[] = [];
  const addPoly = (p: Pt[], w: (q: Pt, t: number) => number) => {
    for (let i = 0; i < p.length - 1; i++) {
      const t0 = i / (p.length - 1);
      const t1 = (i + 1) / (p.length - 1);
      segs.push({ ax: p[i].x, az: p[i].z, bx: p[i + 1].x, bz: p[i + 1].z, wa: w(p[i], t0), wb: w(p[i + 1], t1) });
    }
  };
  const wig = (q: Pt, a: number, b: number) => a + b * (fbm(nB, q.x * 0.18 + 7, q.z * 0.18 + 7, 3) * 0.5 + 0.5);
  addPoly(entry, (q) => wig(q, 0.95, 0.35));
  addPoly(detour, (q) => wig(q, 1.1, 0.55));
  addPoly(direct, (_q, t) => 0.95 - 0.2 * smoothstep(0.45, 0.65, t) + 0.2 * smoothstep(0.85, 1, t));
  segs.push({ ax: G.x, az: G.z, bx: G.x, bz: G.z, wa: 2.0, wb: 2.0 });
  segs.push({ ax: J.x, az: J.z, bx: J.x, bz: J.z, wa: 1.45, wb: 1.45 });

  /* the direct branch's hazards: a drop across the floor, then rubble */
  const CREV = 4.8;
  const boulders: { x: number; z: number; r: number; h: number }[] = [
    [8.2, 0.3], [8.9, -0.32], [9.6, 0.08], [10.3, -0.18], [10.9, 0.3],
  ].map(([t, l]) => ({ x: J.x + ux * t - uz * l, z: J.z + uz * t + ux * l, r: 0.28 + rnd() * 0.1, h: 0.45 + rnd() * 0.2 }));
  for (let k = 0; k < 6; k++) {
    const i = Math.floor((0.1 + rnd() * 0.8) * (detour.length - 1));
    const a = detour[i];
    const b = detour[i + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = (0.85 + rnd() * 0.3) * side;
    boulders.push({ x: a.x - ((b.z - a.z) / l) * off, z: a.z + ((b.x - a.x) / l) * off, r: 0.2 + rnd() * 0.15, h: 0.3 + rnd() * 0.3 });
  }

  /* fine raster: signed distance to passage, then floor / wall / ceiling */
  const R = res;
  const floor = new Float32Array(R * R);
  const ceil = new Float32Array(R * R);
  const sdfF = new Float32Array(R * R);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const x = (i / (R - 1)) * E;
      const z = (j / (R - 1)) * E;
      let best = 1e9;
      for (const g of segs) {
        const vx = g.bx - g.ax;
        const vz = g.bz - g.az;
        const wx = x - g.ax;
        const wz = z - g.az;
        const L2 = vx * vx + vz * vz;
        const t = L2 > 0 ? Math.min(1, Math.max(0, (wx * vx + wz * vz) / L2)) : 0;
        const ex = wx - vx * t;
        const ez = wz - vz * t;
        const d = Math.sqrt(ex * ex + ez * ez) - (g.wa + (g.wb - g.wa) * t);
        if (d < best) best = d;
      }
      const k = j * R + i;
      sdfF[k] = best;

      let f = 0.16 * fbm(nF, x * 0.22, z * 0.22, 3) + 0.05 * fbm(nR, x * 1.6, z * 1.6, 2);
      const along = (x - J.x) * ux + (z - J.z) * uz;
      const lat = Math.abs(-(x - J.x) * uz + (z - J.z) * ux);
      if (along > 0 && along < dLen) f -= 1.5 * (1 - smoothstep(0.3, 0.62, Math.abs(along - CREV))) * (1 - smoothstep(1.3, 2.2, lat));
      for (const b of boulders) {
        const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
        if (d2 < 4) f += b.h * Math.exp(-d2 * 1.4);
      }
      const rock = smoothstep(0, 0.9, best);
      const h = f + wallTop * rock + 0.2 * fbm(nR, x * 2.2, z * 2.2, 3) * smoothstep(-0.1, 0.3, best);
      floor[k] = Math.min(h, f + wallTop + 0.3);
      const roof = Math.max(f, 0) + 2.3 + 0.35 * fbm(nA, x * 0.6 + 40, z * 0.6, 3) - 2.2 * smoothstep(-0.9, 0.35, best);
      ceil[k] = Math.max(floor[k], roof);
    }
  }

  const fine = (field: Float32Array, x: number, z: number) => {
    const fx = Math.min(R - 1.001, Math.max(0, (x / E) * (R - 1)));
    const fz = Math.min(R - 1.001, Math.max(0, (z / E) * (R - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = field[j * R + i];
    const b = field[j * R + i + 1];
    const c = field[(j + 1) * R + i];
    const d = field[(j + 1) * R + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };

  /* map grid */
  const cell = E / n;
  const height = new Float32Array(n * n);
  const sdfM = new Float32Array(n * n);
  const open = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * cell;
      const z = (j + 0.5) * cell;
      const k = j * n + i;
      height[k] = fine(floor, x, z);
      sdfM[k] = fine(sdfF, x, z);
      open[k] = sdfM[k] < 0 ? 1 : 0;
    }
  }

  const risk = new Float32Array(n * n);
  const H = (i: number, j: number) => height[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = H(i, j);
      const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
      const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      let step = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) step = Math.max(step, Math.abs(H(i + a, j + b) - h));
      const rough = Math.abs(h - (H(i + 1, j) + H(i - 1, j) + H(i, j + 1) + H(i, j - 1)) / 4);
      risk[j * n + i] = 1 - (1 - sat(slope / 1.1)) * (1 - sat((step - 0.06) / 0.3)) * (1 - sat(rough / 0.1));
    }
  }

  /* rover path: entry tunnel, then the long way round */
  const ds = 0.1;
  const pts: Pt[] = [...entry, ...detour.slice(1)];
  const length = polyLen(pts) - 0.05;
  const path: PassagePose[] = [];
  let seg = 0;
  let segS = 0;
  for (let s = 0; s <= length; s += ds) {
    while (seg < pts.length - 2) {
      const l = Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].z - pts[seg].z);
      if (segS + l >= s) break;
      segS += l;
      seg++;
    }
    const a = pts[seg];
    const b = pts[seg + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const t = Math.min(1, (s - segS) / l);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    path.push({ x, z, y: fine(floor, x, z), heading: 0, s });
  }
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 6)];
    const b = path[Math.min(path.length - 1, i + 6)];
    path[i].heading = Math.atan2(b.z - a.z, b.x - a.x);
  }
  const base = Math.min(...path.map((p) => p.y)) - 0.15;

  /* range sensor with occlusion, swept along the path */
  const s1 = new Float32Array(n * n).fill(Infinity);
  const r1 = new Float32Array(n * n).fill(Infinity);
  const s2 = new Float32Array(n * n).fill(Infinity);
  const r2 = new Float32Array(n * n).fill(Infinity);
  const RAYS = 240;
  const stepLen = cell * 0.45;
  for (let pi = 0; pi < path.length; pi += 3) {
    const p = path[pi];
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * TAU;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      let last = -1;
      for (let d = 0; d <= range; d += stepLen) {
        const i = Math.floor((p.x + cx * d) / cell);
        const j = Math.floor((p.z + cz * d) / cell);
        if (i < 0 || j < 0 || i >= n || j >= n) break;
        const k = j * n + i;
        if (k === last) continue;
        last = k;
        if (s1[k] === Infinity) {
          s1[k] = p.s;
          r1[k] = d;
        }
        if (d < r2[k]) {
          r2[k] = d;
          s2[k] = p.s;
        }
        if (sdfM[k] > 0.12) break;
      }
    }
  }

  return {
    extent: E, res: R, floor, ceil, n, cell, height, risk, open, s1, r1, s2, r2, path, ds, length, range, base, wallTop,
    junction: polyLen(entry),
    direct: direct.map((p) => ({ ...p, y: fine(floor, p.x, p.z) })),
    directLen: dLen,
    detourLen: polyLen(detour),
  };
}

export function poseAtS(P: Passage, s: number): PassagePose {
  const f = Math.min(P.path.length - 1.001, Math.max(0, s / P.ds));
  const i = Math.floor(f);
  const t = f - i;
  const a = P.path[i];
  const b = P.path[i + 1];
  let dh = b.heading - a.heading;
  if (dh > Math.PI) dh -= TAU;
  if (dh < -Math.PI) dh += TAU;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    y: a.y + (b.y - a.y) * t,
    heading: a.heading + dh * t,
    s: a.s + (b.s - a.s) * t,
  };
}

/** Uncertainty of cell k at path distance s: -1 if unseen, else 0 (seen up close) … 1 (seen at max range). */
export function cellUncertainty(P: Passage, k: number, s: number): number {
  if (s < P.s1[k]) return -1;
  const r = s >= P.s2[k] ? P.r2[k] : P.r1[k];
  return Math.min(1, r / P.range);
}

/** Displayed risk: geometric risk, inflated where the cell was only glimpsed from far away. */
export function shownRisk(risk: number, unc: number): number {
  return Math.min(1, risk + 0.45 * unc * (1 - risk));
}

export function passageStats(P: Passage, s: number) {
  let open = 0;
  let known = 0;
  let unc = 0;
  for (let k = 0; k < P.open.length; k++) {
    if (!P.open[k]) continue;
    open++;
    const u = cellUncertainty(P, k, s);
    if (u >= 0) {
      known++;
      unc += u;
    }
  }
  return { mapped: known / Math.max(1, open), meanUnc: known ? unc / known : 1 };
}

/** Passage risk ramp (sRGB 0..255): cool slate (traversable) → ochre → signal orange (wall / drop / obstacle). */
export const PASSAGE_RAMP: [number, number, number][] = [
  [58, 72, 82],
  [168, 98, 36],
  [255, 124, 52],
];

export function passageRamp(t: number): [number, number, number] {
  const [a, b, c] = PASSAGE_RAMP;
  const m = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [p, q] = t < 0.5 ? [a, b] : [b, c];
  return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
}
