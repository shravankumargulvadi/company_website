/**
 * Confined-passage model (cave / tunnel / culvert) used by Candidate A's
 * underground chapter and the passage proof placeholder.
 *
 * Deterministic: a looped passage with a side branch, rubble, boulders and a
 * ledge; a rover path through it; a 360° range sensor with occlusion; and a
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
}

export interface PassageOptions {
  res?: number;
  n?: number;
  seed?: number;
}

const TAU = Math.PI * 2;
const sat = (v: number) => Math.min(1, Math.max(0, v));
const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

interface Seg {
  ax: number; az: number; bx: number; bz: number;
  wa: number; wb: number; th: number; loop: boolean;
}

export function createPassage(opts: PassageOptions = {}): Passage {
  const { res = 224, n = 96, seed = 7 } = opts;
  const E = 30;
  const C = E / 2;
  const wallTop = 2.4;
  const range = 6;
  const nA = createNoise2D(seed);
  const nB = createNoise2D(seed + 11);
  const nF = createNoise2D(seed + 23);
  const nR = createNoise2D(seed + 37);
  const rnd = mulberry32(seed + 5);

  /* centreline: a closed, irregular loop with one chamber */
  const M = 420;
  const cl: { x: number; z: number; w: number; th: number }[] = [];
  for (let i = 0; i < M; i++) {
    const th = (i / M) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = 1 + 0.2 * fbm(nA, 3 + 1.2 * c, 3 + 1.2 * s, 3);
    let w = 0.95 + 0.6 * (fbm(nB, 7 + 1.6 * c, 7 + 1.6 * s, 3) * 0.5 + 0.5);
    w += 1.5 * Math.exp(-(angDist(th, 2.4) ** 2) / 0.05);
    cl.push({ x: C + 10.8 * r * c, z: C + 8.6 * r * s, w, th });
  }

  const segs: Seg[] = [];
  for (let i = 0; i < M; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % M];
    segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, wa: a.w, wb: b.w, th: a.th, loop: true });
  }

  /* dead-end side branch the rover never enters: it stays partly unknown */
  const b0 = cl[Math.round((5.15 / TAU) * M)];
  const ox = b0.x - C;
  const oz = b0.z - C;
  const ol = Math.hypot(ox, oz);
  const dx = ox / ol;
  const dz = oz / ol;
  let px = b0.x;
  let pz = b0.z;
  const K = 24;
  for (let k = 1; k <= K; k++) {
    const t = k / K;
    const wig = Math.sin(t * 4) * 0.9;
    const qx = b0.x + dx * 9.5 * t - dz * wig;
    const qz = b0.z + dz * 9.5 * t + dx * wig;
    segs.push({ ax: px, az: pz, bx: qx, bz: qz, wa: 0.85 - 0.35 * (t - 1 / K), wb: 0.85 - 0.35 * t, th: -1, loop: false });
    px = qx;
    pz = qz;
  }

  /* boulders, placed off the driving line */
  const boulders: { x: number; z: number; r: number; h: number }[] = [];
  for (let k = 0; k < 9; k++) {
    const i = Math.floor((0.08 + rnd() * 0.84) * M);
    const a = cl[i];
    const b = cl[(i + 1) % M];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / l;
    const nz = (b.x - a.x) / l;
    const side = rnd() < 0.5 ? -1 : 1;
    const off = (0.62 + rnd() * 0.22) * a.w * side;
    boulders.push({ x: a.x + nx * off, z: a.z + nz * off, r: 0.22 + rnd() * 0.18, h: 0.35 + rnd() * 0.4 });
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
      let th = -1;
      let lat = 0;
      for (const g of segs) {
        const vx = g.bx - g.ax;
        const vz = g.bz - g.az;
        const wx = x - g.ax;
        const wz = z - g.az;
        const L2 = vx * vx + vz * vz;
        const t = Math.min(1, Math.max(0, (wx * vx + wz * vz) / L2));
        const ex = wx - vx * t;
        const ez = wz - vz * t;
        const d = Math.sqrt(ex * ex + ez * ez) - (g.wa + (g.wb - g.wa) * t);
        if (d < best) {
          best = d;
          th = g.loop ? g.th : -1;
          lat = (vx * wz - vz * wx) / Math.sqrt(L2);
        }
      }
      const k = j * R + i;
      sdfF[k] = best;

      let f = 0.18 * fbm(nF, x * 0.22, z * 0.22, 3) + 0.05 * fbm(nR, x * 1.6, z * 1.6, 2);
      if (th >= 0) {
        const span = smoothstep(0.7, 0.85, th) * (1 - smoothstep(1.75, 1.95, th));
        f -= 0.42 * span * smoothstep(0.42, 0.55, lat);
      }
      for (const b of boulders) {
        const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
        if (d2 < 4) f += b.h * Math.exp(-d2 * 1.4);
      }
      const rock = smoothstep(0, 0.9, best);
      const h = f + wallTop * rock + 0.2 * fbm(nR, x * 2.2, z * 2.2, 3) * smoothstep(-0.1, 0.3, best);
      floor[k] = Math.min(h, f + wallTop + 0.3);
      const roof = f + 2.3 + 0.35 * fbm(nA, x * 0.6 + 40, z * 0.6, 3) - 2.2 * smoothstep(-0.9, 0.35, best);
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

  /* rover path: inner side of the loop, ~93% of the way round */
  const ds = 0.1;
  const off: { x: number; z: number }[] = cl.map((a, i) => {
    const b = cl[(i + 1) % M];
    const p = cl[(i - 1 + M) % M];
    const tx = b.x - p.x;
    const tz = b.z - p.z;
    const l = Math.hypot(tx, tz);
    return { x: a.x + (tz / l) * 0.3, z: a.z - (tx / l) * 0.3 };
  });
  const start = Math.round((0.25 / TAU) * M);
  const pts: { x: number; z: number }[] = [];
  for (let k = 0; k <= M; k++) pts.push(off[(start + k) % M]);
  const total = pts.slice(1).reduce((acc, p, i) => acc + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);
  const length = total * 0.93;
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

  return { extent: E, res: R, floor, ceil, n, cell, height, risk, open, s1, r1, s2, r2, path, ds, length, range, base, wallTop };
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
