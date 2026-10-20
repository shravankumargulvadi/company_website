/** Shared forest geometry, route assessment and reconnaissance timeline. */
export interface ForestPoint { x: number; z: number }
export interface ForestTree extends ForestPoint { radius: number; height: number; crown: number }
export interface ForestHazard extends ForestPoint { id: string; label: string; radius: number; kind: 'obstacle' | 'choke' | 'slope' }
export interface ForestRoute {
  id: string; name: string; reason: string; points: ForestPoint[];
  length: number; clearance: number; slope: number; score: number;
}
/** Drone centre height when its skids rest on the UGV launch deck. */
export const FOREST_LAUNCH_HEIGHT = 1.22;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function forestHeight(x: number, z: number) {
  const rolling = 0.3 + Math.sin(x * 0.12) * Math.cos(z * 0.07) * 0.32;
  const roots = Math.sin(x * 0.8 + z * 0.12) * Math.sin(z * 0.6) * 0.055;
  const drainage = -3.8 * Math.exp(-(((x + 19) / 10) ** 2 + ((z - 40) / 5) ** 2));
  return rolling + roots + drainage;
}

export function forestSlope(x: number, z: number) {
  const dx = forestHeight(x + 0.4, z) - forestHeight(x - 0.4, z);
  const dz = forestHeight(x, z + 0.4) - forestHeight(x, z - 0.4);
  return Math.atan(Math.hypot(dx, dz) / 0.8) * 180 / Math.PI;
}

function segmentDistance(p: ForestPoint, a: ForestPoint, b: ForestPoint) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / Math.max(1e-9, vx * vx + vz * vz));
  return Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t);
}

export function forestPathDistance(point: ForestPoint, path: ForestPoint[]) {
  let distance = Infinity;
  for (let i = 1; i < path.length; i++) distance = Math.min(distance, segmentDistance(point, path[i - 1], path[i]));
  return distance;
}

function curve(controls: ForestPoint[]) {
  const c = [controls[0], ...controls, controls[controls.length - 1]];
  const points: ForestPoint[] = [];
  for (let i = 1; i < c.length - 2; i++) for (let j = 0; j < 20; j++) {
    const t = j / 20;
    const value = (key: 'x' | 'z') => {
      const [a, b, d, e] = [c[i - 1][key], c[i][key], c[i + 1][key], c[i + 2][key]];
      return 0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (-a + 3 * b - 3 * d + e) * t * t * t);
    };
    points.push({ x: value('x'), z: value('z') });
  }
  points.push(controls[controls.length - 1]);
  return points;
}

function along(points: ForestPoint[], fraction: number) {
  const index = clamp(fraction) * (points.length - 1), i = Math.floor(index);
  const a = points[i], b = points[Math.min(points.length - 1, i + 1)];
  return { x: lerp(a.x, b.x, index - i), z: lerp(a.z, b.z, index - i) };
}

export function createForestRecon() {
  const entry = { x: 0, z: 88 }, fork = { x: 0, z: 64 }, goal = { x: 0, z: 8 };
  const prefix = Array.from({ length: 25 }, (_, i) => ({ x: 0, z: 88 - i }));
  const definitions = [
    { id: 'direct', name: 'Direct passage', reason: 'Choke point · fallen timber', controls: [fork, { x: 0, z: 44 }, { x: 0, z: 24 }, goal] },
    { id: 'drainage', name: 'Drainage corridor', reason: 'Steep cut · difficult footing', controls: [fork, { x: -15, z: 55 }, { x: -20, z: 39 }, { x: -14, z: 21 }, goal] },
    { id: 'flank', name: 'Eastern corridor', reason: 'Clear passage · gentler ground', controls: [fork, { x: 15, z: 55 }, { x: 21, z: 39 }, { x: 15, z: 21 }, goal] },
  ];
  const paths = definitions.map(route => [...prefix, ...curve(route.controls).slice(1)]);
  const exploration = curve([fork, { x: 0, z: 55 }, { x: -12, z: 53 }, { x: -7, z: 60 }, fork]);
  let seed = 7419;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const trees: ForestTree[] = [];
  for (let z = 2; z < 98; z += 3.3) for (let x = -35; x < 36; x += 3.3) {
    const tree = { x: x + (random() - 0.5) * 2.3, z: z + (random() - 0.5) * 2.3,
      radius: 0.22 + random() * 0.32, height: 12 + random() * 9, crown: 3.7 + random() * 2.8 };
    if (paths.some((path, i) => forestPathDistance(tree, path) < (i === 2 ? 3.0 : 1.85))) continue;
    if (forestPathDistance(tree, exploration) < 2) continue;
    trees.push(tree);
  }
  trees.push({ x: -0.94, z: 49, radius: 0.58, height: 17, crown: 5 }, { x: 0.94, z: 49, radius: 0.58, height: 19, crown: 5 });
  const treeCells = new Map<string, ForestTree[]>();
  for (const tree of trees) {
    const key = `${Math.floor(tree.x / 4)},${Math.floor(tree.z / 4)}`;
    const cell = treeCells.get(key) ?? [];
    cell.push(tree); treeCells.set(key, cell);
  }
  const hazards: ForestHazard[] = [
    { id: 'choke', label: 'Narrow choke point', x: 0, z: 49, radius: 2, kind: 'choke' },
    { id: 'deadfall', label: 'Fallen timber', x: 0, z: 43, radius: 4.2, kind: 'obstacle' },
    { id: 'drainage', label: 'Steep drainage cut', x: -19, z: 40, radius: 6.5, kind: 'slope' },
  ];
  const routes: ForestRoute[] = definitions.map((definition, index) => {
    const points = paths[index];
    let length = 0, clearance = Infinity, slope = 0, blocked = false;
    points.forEach((p, i) => {
      if (i) length += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
      slope = Math.max(slope, forestSlope(p.x, p.z));
      for (const tree of trees) clearance = Math.min(clearance, Math.hypot(p.x - tree.x, p.z - tree.z) - tree.radius);
      if (Math.abs(p.x) < 4.2 && Math.abs(p.z - 43) < 0.7) blocked = true;
    });
    const score = Math.round(100 * clamp((blocked ? 0.7 : 0) + 0.65 * slope / 35 + 0.35 * (1 - clamp(clearance / 2.5))));
    return { id: definition.id, name: definition.name, reason: definition.reason, points, length, clearance, slope, score };
  });
  const best = routes.reduce((a, b) => a.score <= b.score ? a : b);
  return { trees, treeCells, hazards, routes, best, entry, fork, goal, exploration };
}

export type ForestRecon = ReturnType<typeof createForestRecon>;

export function forestState(progress: number) {
  return {
    launch: smooth(progress / 0.1),
    compare: smooth((progress - 0.24) / 0.17),
    scouting: clamp((progress - 0.5) / 0.3),
    recommended: smooth((progress - 0.8) / 0.055),
    ugv: smooth((progress - 0.89) / 0.105),
    team: smooth((progress - 0.9) / 0.1),
  };
}

export function forestScoutPose(model: ForestRecon, progress: number) {
  const state = forestState(progress);
  let p: ForestPoint;
  if (progress < 0.1) p = model.entry;
  else if (progress < 0.22) p = along([model.entry, model.fork], smooth((progress - 0.1) / 0.12));
  else if (progress < 0.5) p = along(model.exploration, clamp((progress - 0.22) / 0.28));
  else p = along(model.best.points.slice(24), state.scouting);
  return { ...p, y: forestHeight(p.x, p.z) + FOREST_LAUNCH_HEIGHT + state.launch * (2.8 - FOREST_LAUNCH_HEIGHT) };
}

export function forestUgvPose(model: ForestRecon, progress: number) {
  const phase = forestState(progress).ugv * 0.72;
  const p = along(model.best.points, phase);
  const a = along(model.best.points, Math.max(0, phase - 0.001));
  const b = along(model.best.points, Math.min(1, phase + 0.001));
  return { ...p, y: forestHeight(p.x, p.z), heading: Math.atan2(b.x - a.x, -(b.z - a.z)) };
}

export function forestTeamPose(model: ForestRecon, progress: number) {
  const p = along(model.best.points, forestState(progress).team * 0.62);
  return { ...p, y: forestHeight(p.x, p.z) };
}

export function forestObservationSamples(model: ForestRecon) {
  return Array.from({ length: 81 }, (_, i) => ({ ...forestScoutPose(model, i / 100), at: i / 100 }));
}

export function forestObservedAt(samples: ReturnType<typeof forestObservationSamples>, x: number, z: number) {
  for (const sample of samples) if (Math.hypot(x - sample.x, z - sample.z) <= 17) return sample.at;
  return 2;
}

export function forestRisk(model: ForestRecon, x: number, z: number) {
  let clearance = Infinity;
  // Only trunks within 2.3 m affect this local risk term; avoid a full forest scan per map cell.
  const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const tree of model.treeCells.get(`${cx + dx},${cz + dz}`) ?? []) {
      clearance = Math.min(clearance, Math.hypot(x - tree.x, z - tree.z) - tree.radius);
    }
  }
  const timber = Math.abs(x) < 4.3 && Math.abs(z - 43) < 0.9 ? 1 : 0;
  return clamp(forestSlope(x, z) / 35 * 0.6 + (1 - clamp(clearance / 1.7)) * 0.6 + timber);
}
