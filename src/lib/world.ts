/**
 * Shared procedural "world" used by every candidate: terrain, hazards,
 * an embodiment-aware risk model and a simple sampling planner.
 * Coordinates are normalised: u, v in [0, 1].
 */
import { createNoise2D, fbm, mulberry32 } from './noise';

export interface Threat {
  u: number;
  v: number;
  r: number;
}

export interface World {
  size: number;
  height: Float32Array; // [-1, 1]
  slope: Float32Array; // [0, 1]
  obstacle: Float32Array; // [0, 1] positive obstacles (rocks, rubble)
  negative: Float32Array; // [0, 1] negative obstacles (holes, ditches)
  ambiguity: Float32Array; // [0, 1] where sensing is unreliable (dust, vegetation, clutter)
  water: Float32Array; // [0, 1]
  threat: Float32Array; // [0, 1]
  threats: Threat[];
  waterLevel: number;
}

export interface WorldOptions {
  hazards?: boolean;
  size?: number;
  seed?: number;
  waterLevel?: number;
  threats?: Threat[];
  frequency?: number;
  /** If set, overrides waterLevel so this fraction of the map is water. */
  waterFraction?: number;
}

const DEFAULT_THREATS: Threat[] = [
  { u: 0.62, v: 0.38, r: 0.075 },
  { u: 0.3, v: 0.7, r: 0.06 },
  { u: 0.78, v: 0.74, r: 0.05 },
];

export function createWorld(opts: WorldOptions = {}): World {
  const size = opts.size ?? 160;
  const seed = opts.seed ?? 11;
  let waterLevel = opts.waterLevel ?? -0.38;
  const threats = opts.threats ?? DEFAULT_THREATS;
  const freq = opts.frequency ?? 3;
  const n1 = createNoise2D(seed);
  const n2 = createNoise2D(seed * 7 + 3);

  const N = size * size;
  const height = new Float32Array(N);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / (size - 1);
      const y = j / (size - 1);
      const base = fbm(n1, x * freq, y * freq, 5);
      const ridge = 1 - Math.abs(n2(x * freq * 0.55 + 4.1, y * freq * 0.55 - 2.3));
      const h = base * 0.85 + (ridge * ridge - 0.45) * 0.55;
      height[j * size + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  for (let k = 0; k < N; k++) height[k] = ((height[k] - min) / (max - min)) * 2 - 1;
  if (opts.waterFraction !== undefined) {
    const sorted = Float32Array.from(height).sort();
    waterLevel = sorted[Math.floor(opts.waterFraction * (N - 1))];
  }

  const slope = new Float32Array(N);
  let smax = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = height[j * size + Math.max(0, i - 1)];
      const r = height[j * size + Math.min(size - 1, i + 1)];
      const d = height[Math.max(0, j - 1) * size + i];
      const u = height[Math.min(size - 1, j + 1) * size + i];
      const s = Math.hypot(r - l, u - d);
      slope[j * size + i] = s;
      if (s > smax) smax = s;
    }
  }
  const sRef = smax * 0.55;
  for (let k = 0; k < N; k++) slope[k] = Math.min(1, slope[k] / sRef) ** 1.6;

  /* discrete hazards, stamped after slope so each risk type stays separable */
  const obstacle = new Float32Array(N);
  const negative = new Float32Array(N);
  if (opts.hazards) {
    const rnd = mulberry32(seed * 31 + 5);
    const stamp = (u: number, v: number, r: number, out: Float32Array, dh: number) => {
      const R = Math.ceil(3 * r * (size - 1));
      const ci = Math.round(u * (size - 1));
      const cj = Math.round(v * (size - 1));
      for (let j = Math.max(0, cj - R); j <= Math.min(size - 1, cj + R); j++) {
        for (let i = Math.max(0, ci - R); i <= Math.min(size - 1, ci + R); i++) {
          const g = Math.exp(-((i / (size - 1) - u) ** 2 + (j / (size - 1) - v) ** 2) / (2 * r * r));
          const k = j * size + i;
          out[k] = Math.max(out[k], g);
          height[k] += dh * g;
        }
      }
    };
    const spot = () => {
      for (let n = 0; n < 20; n++) {
        const u = 0.06 + rnd() * 0.88;
        const v = 0.06 + rnd() * 0.88;
        if (sample(height, size, u, v) > waterLevel + 0.12) return [u, v] as const;
      }
      return null;
    };
    for (let n = 0; n < 110; n++) {
      const p = spot();
      if (p) stamp(p[0], p[1], 0.005 + rnd() * 0.008, obstacle, 0.06);
    }
    for (let n = 0; n < 22; n++) {
      const p = spot();
      if (p) stamp(p[0], p[1], 0.006 + rnd() * 0.01, negative, -0.09);
    }
    for (let n = 0; n < 4; n++) {
      const p = spot();
      if (!p) continue;
      const a = rnd() * Math.PI;
      const len = 0.08 + rnd() * 0.1;
      for (let t = 0; t <= 1; t += 0.04) {
        stamp(p[0] + Math.cos(a) * len * (t - 0.5), p[1] + Math.sin(a) * len * (t - 0.5), 0.005, negative, -0.03);
      }
    }
  }

  const ambiguity = new Float32Array(N);
  if (opts.hazards) {
    const na = createNoise2D(seed * 13 + 1);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const a = fbm(na, (i / (size - 1)) * 4.5, (j / (size - 1)) * 4.5, 3) * 0.5 + 0.5;
        ambiguity[j * size + i] = smoothstep(0.62, 0.82, a);
      }
    }
  }

  const water = new Float32Array(N);
  const threat = new Float32Array(N);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const x = i / (size - 1);
      const y = j / (size - 1);
      const h = height[k];
      water[k] = smoothstep(waterLevel + 0.05, waterLevel - 0.05, h);
      let t = 0;
      for (const th of threats) {
        const d2 = (x - th.u) ** 2 + (y - th.v) ** 2;
        t = Math.max(t, Math.exp(-d2 / (2 * th.r * th.r)));
      }
      threat[k] = t;
    }
  }

  return { size, height, slope, obstacle, negative, ambiguity, water, threat, threats, waterLevel };
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Bilinear sample of a world field at normalised (u, v). */
export function sample(field: Float32Array, size: number, u: number, v: number): number {
  const x = Math.min(size - 1.001, Math.max(0, u * (size - 1)));
  const y = Math.min(size - 1.001, Math.max(0, v * (size - 1)));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = field[j * size + i];
  const b = field[j * size + i + 1];
  const c = field[(j + 1) * size + i];
  const d = field[(j + 1) * size + i + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Grid cell (as u, v) with the best score; `score` returns -Infinity to reject. */
export function findSpot(w: World, score: (u: number, v: number, k: number) => number) {
  let best = { u: 0.5, v: 0.5 };
  let bestScore = -Infinity;
  for (let j = 2; j < w.size - 2; j += 2) {
    for (let i = 2; i < w.size - 2; i += 2) {
      const u = i / (w.size - 1);
      const v = j / (w.size - 1);
      const s = score(u, v, j * w.size + i);
      if (s > bestScore) {
        bestScore = s;
        best = { u, v };
      }
    }
  }
  return best;
}

/* ---------- Embodiment-aware risk ---------- */

export type EmbodimentId = 'ugv' | 'uav' | 'legged' | 'maritime';

/**
 * Embodiment-specific weights on shared risk terms. The reasoning (risk under
 * uncertainty) is shared; what counts as dangerous depends on the body.
 */
export interface RiskProfile {
  slope: number;
  water: number;
  land: number;
  threat: number;
  unknown: number;
}

export const PROFILES: Record<EmbodimentId, RiskProfile> = {
  ugv: { slope: 1.1, water: 1, land: 0, threat: 0.85, unknown: 0.55 },
  legged: { slope: 0.45, water: 1, land: 0, threat: 0.85, unknown: 0.5 },
  uav: { slope: 0, water: 0, land: 0, threat: 1, unknown: 0.25 },
  maritime: { slope: 0, water: 0, land: 1, threat: 0.85, unknown: 0.5 },
};

export const EMBODIMENT_LABELS: Record<EmbodimentId, string> = {
  ugv: 'Ground',
  uav: 'Air',
  legged: 'Legged',
  maritime: 'Maritime',
};

/** Combined risk in [0, 1]. `knowledge` is 1 where well observed, 0 where unknown. */
export function riskAt(
  w: World,
  u: number,
  v: number,
  knowledge: number,
  p: RiskProfile = PROFILES.ugv,
): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 1;
  const s = Math.max(sample(w.slope, w.size, u, v), sample(w.obstacle, w.size, u, v), sample(w.negative, w.size, u, v));
  const wa = sample(w.water, w.size, u, v);
  const th = sample(w.threat, w.size, u, v);
  const terrain = Math.min(1, p.slope * s + p.water * wa + p.land * (1 - wa));
  const unk = p.unknown * (1 - knowledge);
  const amb = 0.8 * sample(w.ambiguity, w.size, u, v);
  return 1 - (1 - terrain) * (1 - p.threat * th) * (1 - unk) * (1 - amb);
}

/* ---------- Knowledge (belief coverage) ---------- */

export class KnowledgeMap {
  readonly size: number;
  readonly data: Float32Array;
  constructor(size = 64) {
    this.size = size;
    this.data = new Float32Array(size * size);
  }
  reveal(u: number, v: number, radius: number, strength = 1) {
    const s = this.size;
    const r = radius * s;
    const ci = u * (s - 1);
    const cj = v * (s - 1);
    const i0 = Math.max(0, Math.floor(ci - r));
    const i1 = Math.min(s - 1, Math.ceil(ci + r));
    const j0 = Math.max(0, Math.floor(cj - r));
    const j1 = Math.min(s - 1, Math.ceil(cj + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d >= 1) continue;
        const k = j * s + i;
        const add = (1 - d * d) * strength;
        this.data[k] = Math.min(1, this.data[k] + add * (1 - this.data[k]));
      }
    }
  }
  get(u: number, v: number) {
    return sample(this.data, this.size, u, v);
  }
  clear() {
    this.data.fill(0);
  }
  /** Exponential forgetting: unrevisited areas slowly become uncertain again. */
  decay(factor: number) {
    for (let k = 0; k < this.data.length; k++) this.data[k] *= factor;
  }
}

/* ---------- Planner ---------- */

export interface Pose {
  u: number;
  v: number;
  /** Radians; 0 points along +u. */
  heading: number;
}

export interface Trajectory {
  points: [number, number][];
  cost: number;
  maxRisk: number;
}

export interface PlanOptions {
  count?: number;
  length?: number;
  steps?: number;
  spread?: number;
  goalWeight?: number;
}

/** Sample constant-curvature arcs and score them by risk and progress. */
export function planArcs(
  pose: Pose,
  goal: { u: number; v: number },
  risk: (u: number, v: number) => number,
  opts: PlanOptions = {},
): { candidates: Trajectory[]; best: number } {
  const count = opts.count ?? 13;
  const length = opts.length ?? 0.22;
  const steps = opts.steps ?? 22;
  const spread = opts.spread ?? 7;
  const goalWeight = opts.goalWeight ?? 1.6;
  const ds = length / steps;
  const candidates: Trajectory[] = [];
  let best = 0;
  let bestCost = Infinity;
  const startDist = Math.hypot(goal.u - pose.u, goal.v - pose.v);

  for (let c = 0; c < count; c++) {
    const k = count === 1 ? 0 : -spread + (2 * spread * c) / (count - 1);
    let { u, v, heading } = pose;
    const pts: [number, number][] = [[u, v]];
    let sum = 0;
    let mx = 0;
    for (let s = 0; s < steps; s++) {
      heading += k * ds;
      u += Math.cos(heading) * ds;
      v += Math.sin(heading) * ds;
      pts.push([u, v]);
      const r = risk(u, v);
      sum += r;
      if (r > mx) mx = r;
    }
    const progress = (startDist - Math.hypot(goal.u - u, goal.v - v)) / length;
    const cost = sum / steps + mx * 0.6 - progress * goalWeight * 0.5;
    candidates.push({ points: pts, cost, maxRisk: mx });
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return { candidates, best };
}

/** Receding-horizon rollout: repeatedly plan and execute the first part of the best arc. */
export function rollout(
  start: Pose,
  goal: { u: number; v: number },
  risk: (u: number, v: number) => number,
  iterations = 40,
  opts: PlanOptions & { execute?: number } = {},
): Pose[] {
  const execute = opts.execute ?? 4;
  const path: Pose[] = [{ ...start }];
  let pose = { ...start };
  for (let it = 0; it < iterations; it++) {
    if (Math.hypot(goal.u - pose.u, goal.v - pose.v) < 0.03) break;
    const { candidates, best } = planArcs(pose, goal, risk, opts);
    const pts = candidates[best].points;
    for (let s = 1; s <= execute && s < pts.length; s++) {
      const [pu, pv] = pts[s - 1];
      const [u, v] = pts[s];
      pose = { u, v, heading: Math.atan2(v - pv, u - pu) };
      path.push(pose);
    }
  }
  return path;
}

/** Interpolate along a pose path by normalised parameter t in [0, 1]. */
export function poseAt(path: Pose[], t: number): Pose {
  const x = Math.min(path.length - 1.0001, Math.max(0, t * (path.length - 1)));
  const i = Math.floor(x);
  const f = x - i;
  const a = path[i];
  const b = path[i + 1] ?? a;
  let dh = b.heading - a.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f, heading: a.heading + dh * f };
}

export { mulberry32 };
