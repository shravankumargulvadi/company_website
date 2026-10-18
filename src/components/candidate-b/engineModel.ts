/**
 * Build-time model for candidate B's assembled system diagram.
 * Everything here runs in Astro frontmatter, so the browser receives plain SVG.
 */
import { createWorld, KnowledgeMap, planArcs, riskAt, rollout, sample, type Pose } from '../../lib/world';
import { mulberry32 } from '../../lib/noise';

export const MAP = { x: 40, y: 70, cols: 30, rows: 20, cell: 18 };
export const MAP_W = MAP.cols * MAP.cell;
export const MAP_H = MAP.rows * MAP.cell;

const toX = (u: number) => MAP.x + u * MAP_W;
const toY = (v: number) => MAP.y + v * MAP_H;

function ramp(t: number) {
  const a = [40, 22, 12];
  const b = [170, 74, 24];
  const c = [255, 106, 30];
  const m = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [p, q] = t < 0.5 ? [a, b] : [b, c];
  return `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * m)).join(',')})`;
}

export interface Cell {
  x: number;
  y: number;
  shade: number;
  known: number;
  risk: number;
  riskFill: string;
  frontier: boolean;
}

export function buildEngineModel() {
  const world = createWorld({ size: 96, seed: 23, waterFraction: 0.07 });
  const goal = { u: 0.9, v: 0.22 };
  const start: Pose = { u: 0.08, v: 0.8, heading: -0.5 };
  const truthRisk = (u: number, v: number) => riskAt(world, u, v, 1);
  const path = rollout(start, goal, truthRisk, 90, { execute: 3, length: 0.18 });

  const know = new KnowledgeMap(64);
  const cut = Math.floor(path.length * 0.42);
  for (let i = 0; i <= cut; i++) know.reveal(path[i].u, path[i].v, 0.17, 0.6);
  const pose = path[cut];

  const cells: Cell[] = [];
  for (let j = 0; j < MAP.rows; j++) {
    for (let i = 0; i < MAP.cols; i++) {
      const u = (i + 0.5) / MAP.cols;
      const v = (j + 0.5) / MAP.rows;
      const h = sample(world.height, world.size, u, v);
      const k = know.get(u, v);
      const r = riskAt(world, u, v, k);
      cells.push({
        x: MAP.x + i * MAP.cell,
        y: MAP.y + j * MAP.cell,
        shade: 0.25 + 0.55 * (h * 0.5 + 0.5),
        known: k,
        risk: r,
        riskFill: ramp(r),
        frontier: k > 0.15 && k < 0.55,
      });
    }
  }

  const rand = mulberry32(7);
  const scan: { x: number; y: number; r: number }[] = [];
  for (let n = 0; n < 260; n++) {
    const a = pose.heading + (rand() - 0.5) * 2.4;
    const d = 0.02 + Math.sqrt(rand()) * 0.2;
    const u = pose.u + Math.cos(a) * d;
    const v = pose.v + Math.sin(a) * d * (MAP_W / MAP_H);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    scan.push({ x: toX(u) + (rand() - 0.5) * 3, y: toY(v) + (rand() - 0.5) * 3, r: 0.8 + rand() * 0.9 });
  }

  const beliefRisk = (u: number, v: number) => riskAt(world, u, v, know.get(u, v));
  const { candidates, best } = planArcs(pose, goal, beliefRisk, { count: 13, length: 0.3, steps: 24, spread: 6 });
  const toD = (pts: [number, number][]) =>
    pts.map(([u, v], i) => `${i ? 'L' : 'M'}${toX(u).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');

  const travelled = toD(path.slice(0, cut + 1).map((p) => [p.u, p.v] as [number, number]));
  const plans = candidates.map((c, i) => ({ d: toD(c.points), best: i === best, risk: c.maxRisk }));
  const bestPts = candidates[best].points.map(([u, v]) => [toX(u), toY(v)] as [number, number]);

  return {
    cells,
    scan,
    plans,
    travelled,
    bestPts,
    pose: { x: toX(pose.u), y: toY(pose.v), deg: (pose.heading * 180) / Math.PI },
    goal: { x: toX(goal.u), y: toY(goal.v) },
  };
}
