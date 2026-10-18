/**
 * Candidate C — one continuous Canvas 2D camera that zooms from a single
 * machine reasoning under uncertainty out to a distributed, human-supervised force.
 */
import {
  createWorld, findSpot, KnowledgeMap, planArcs, riskAt, rollout, sample, smoothstep,
  PROFILES, type EmbodimentId, type Pose, type Trajectory, type World,
} from '../../lib/world';
import { contourLine, drawGlyph, hillshade } from '../../lib/simView';
import { PLAN_GLYPHS } from '../../lib/glyphs';
import { mulberry32 } from '../../lib/noise';
import { clamp, lerp } from '../../lib/motion';

export interface ForceState {
  cx: number; cy: number; z: number; follow: number;
  threats: number; fog: number; annot: number; risk: number; plans: number;
  engine: number; others: number; team: number; operator: number; network: number;
  move: number; uplink: number;
}

const Z: ForceState = { cx: 0.5, cy: 0.5, z: 0.16, follow: 1, threats: 0, fog: 0, annot: 0, risk: 0, plans: 0, engine: 0, others: 0, team: 0, operator: 0, network: 0, move: 1, uplink: 0 };
/** Build a stage keyframe from defaults. */
export const forceStage = (s: Partial<ForceState>): ForceState => ({ ...Z, ...s });

/** One keyframe per narrative stage; the page maps scroll progress onto these. */
export const STAGES: ForceState[] = [
  forceStage({ z: 0.14 }),
  forceStage({ z: 0.2, threats: 0.5 }),
  forceStage({ z: 0.34, follow: 0.6, threats: 1, fog: 1, annot: 1 }),
  forceStage({ z: 0.19, threats: 0.8, fog: 1, risk: 1, plans: 1 }),
  forceStage({ z: 0.15, threats: 0.5, fog: 1, risk: 0.45, plans: 1, engine: 1 }),
  forceStage({ z: 0.42, follow: 0.5, threats: 0.5, fog: 0.85, risk: 0.3, plans: 0.4, engine: 0.7, others: 1 }),
  forceStage({ z: 0.72, cx: 0.4, cy: 0.47, follow: 0, threats: 0.5, fog: 0.75, risk: 0.2, plans: 0.2, engine: 0.35, others: 1, team: 1 }),
  forceStage({ z: 0.84, cx: 0.37, cy: 0.5, follow: 0, threats: 0.4, fog: 0.65, risk: 0.15, engine: 0.2, others: 1, team: 1, operator: 1 }),
  forceStage({ z: 1.08, cx: 0.56, cy: 0.52, follow: 0, threats: 0.35, fog: 0.5, risk: 0.12, others: 1, team: 1, operator: 1, network: 1 }),
];

export function stateAt(f: number, stages: ForceState[] = STAGES): ForceState {
  const n = stages.length - 1;
  const x = clamp(f, 0, n);
  const i = Math.min(n - 1, Math.floor(x));
  const t = smoothstep(0.12, 0.88, x - i);
  const a = stages[i];
  const b = stages[i + 1];
  const out = {} as ForceState;
  for (const key of Object.keys(a) as (keyof ForceState)[]) out[key] = lerp(a[key], b[key], t);
  out.z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), t));
  return out;
}

type Group = 'others' | 'team' | 't2' | 't3';
interface Agent { id: EmbodimentId; path: Pose[]; phase: number; speed: number; group: Group; team: number; pose: Pose }
interface Node { u: number; v: number; team: number }

const WORLD_KM = 40;
const DETAIL = { u: 0.2, v: 0.24, span: 0.42 };
const BG = [8, 10, 11];

export interface ForceOptions {
  lowPower?: boolean;
  /** Use this world instead of Candidate C's default. */
  world?: World;
  /** Start pose for the lead machine. */
  start?: Pose;
  hub?: { u: number; v: number };
  /** Centres of the two outer teams, and where their operators sit. */
  teams?: { u: number; v: number }[];
  operators?: { u: number; v: number }[];
}

export class ForceScene {
  readonly world: World;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private base?: HTMLCanvasElement;
  private detail?: HTMLCanvasElement;
  private riskImg: HTMLCanvasElement;
  private riskDetail: HTMLCanvasElement;
  private fogImg: HTMLCanvasElement;
  private fogData: ImageData;
  private know = new KnowledgeMap(128);
  private hero: Pose;
  private heroGoal = 0;
  private waypoints: { u: number; v: number }[];
  private trail: [number, number][] = [];
  private plan: { candidates: Trajectory[]; best: number } = { candidates: [], best: 0 };
  private agents: Agent[] = [];
  private operators: Node[];
  private hub = { u: 0.6, v: 0.5 };
  private time = 0;
  private frameNo = 0;
  private cam = { cx: 0.5, cy: 0.5 };
  ready = false;

  constructor(private canvas: HTMLCanvasElement, opts: ForceOptions = {}) {
    this.ctx = canvas.getContext('2d')!;
    this.world = opts.world ?? createWorld({ size: opts.lowPower ? 160 : 256, seed: 41, waterFraction: 0.1 });
    if (opts.hub) this.hub = opts.hub;
    const w = this.world;
    const rand = mulberry32(5);
    const land = (u: number, v: number) => sample(w.water, w.size, u, v) < 0.2;

    const start = opts.start ?? findSpot(w, (u, v) => -riskAt(w, u, v, 1) * 2 - Math.hypot(u - 0.4, v - 0.45) * 8);
    this.hero = { u: start.u, v: start.v, heading: opts.start?.heading ?? -0.6 };
    this.cam = { cx: start.u, cy: start.v };
    this.waypoints = [[0.05, -0.05], [0.04, 0.05], [-0.05, 0.05], [-0.04, -0.05]].map(([du, dv]) => {
      const p = findSpot(w, (u, v) => -riskAt(w, u, v, 1) - Math.hypot(u - start.u - du, v - start.v - dv) * 10);
      return { u: p.u, v: p.v };
    });

    const water = findSpot(w, (u, v, i) => w.water[i] * 2 - Math.hypot(u - start.u, v - start.v) * 6);
    const near = (u: number, v: number, wantLand = true) =>
      findSpot(w, (x, y) => (wantLand && !land(x, y) ? -9 : 0) - riskAt(w, x, y, 1) * 0.6 - Math.hypot(x - u, y - v) * 12);

    const mk = (id: EmbodimentId, home: { u: number; v: number }, group: Group, team: number) => {
      const p = PROFILES[id];
      const tgt = id === 'maritime'
        ? findSpot(w, (x, y, i) => w.water[i] * 2 - Math.abs(Math.hypot(x - home.u, y - home.v) - 0.1) * 10)
        : id === 'uav'
          ? { u: clamp(home.u + (rand() - 0.5) * 0.24, 0.04, 0.96), v: clamp(home.v + (rand() - 0.5) * 0.24, 0.04, 0.96) }
          : near(clamp(home.u + (rand() - 0.5) * 0.2, 0.04, 0.96), clamp(home.v + (rand() - 0.5) * 0.2, 0.04, 0.96));
      const path = rollout({ ...home, heading: rand() * 6.28 }, tgt, (u, v) => riskAt(w, u, v, 1, p), 60, { execute: 3, length: 0.08, count: 9 });
      this.agents.push({ id, path, phase: rand() * 2, speed: id === 'uav' ? 0.016 : 0.008, group, team, pose: path[0] });
    };

    mk('uav', { u: start.u + 0.05, v: start.v - 0.06 }, 'others', 0);
    mk('legged', near(start.u - 0.06, start.v + 0.05), 'others', 0);
    mk('maritime', water, 'others', 0);
    mk('ugv', near(start.u - 0.12, start.v - 0.1), 'team', 0);
    mk('uav', { u: start.u + 0.12, v: start.v + 0.1 }, 'team', 0);
    mk('ugv', near(start.u + 0.08, start.v - 0.14), 'team', 0);
    const teams = opts.teams ?? [{ u: 0.8, v: 0.26 }, { u: 0.74, v: 0.78 }];
    const mix: EmbodimentId[] = ['ugv', 'uav', 'legged', 'ugv', 'uav', 'uav'];
    teams.forEach((c, ti) => mix.forEach((id) => {
      const home = { u: c.u + (rand() - 0.5) * 0.18, v: c.v + (rand() - 0.5) * 0.18 };
      mk(id, id === 'uav' ? home : near(home.u, home.v), ti ? 't3' : 't2', ti + 1);
    }));
    this.operators = [
      { ...near(start.u - 0.1, start.v + 0.12), team: 0 },
      ...(opts.operators ?? [{ u: 0.9, v: 0.16 }, { u: 0.6, v: 0.88 }]).map((o, i) => ({ ...near(o.u, o.v), team: i + 1 })),
    ];

    const riskPx = (u: number, v: number) => {
      const a = smoothstep(0.22, 0.9, riskAt(w, u, v, 1));
      return [255, 132 - a * 40, 52, a * 120];
    };
    this.riskImg = this.paint(256, 0, 0, 1, riskPx);
    this.riskDetail = this.paint(opts.lowPower ? 256 : 420, DETAIL.u, DETAIL.v, DETAIL.span, riskPx);
    this.fogImg = document.createElement('canvas');
    this.fogImg.width = this.fogImg.height = this.know.size;
    this.fogData = this.fogImg.getContext('2d')!.createImageData(this.know.size, this.know.size);
    for (let i = 0; i < 60; i++) this.know.reveal(start.u + (rand() - 0.5) * 0.04, start.v + (rand() - 0.5) * 0.04, 0.04, 0.4);
  }

  /** Terrain is rasterised once, off the critical path. */
  async build(lowPower = false) {
    const res = lowPower ? 640 : 1024;
    this.base = await this.paintAsync(res, 0, 0, 1);
    this.detail = await this.paintAsync(res, DETAIL.u, DETAIL.v, DETAIL.span);
    this.ready = true;
  }

  private terrainPx(u: number, v: number, levels: number): [number, number, number, number] {
    const w = this.world;
    const h = sample(w.height, w.size, u, v);
    const sh = hillshade(w, u, v);
    const wt = sample(w.water, w.size, u, v);
    let l = 12 + sh * 30 + (h * 0.5 + 0.5) * 12;
    const c = contourLine(h, levels, 0.05) * 0.5 + contourLine(h, levels / 4, 0.025) * 0.5;
    l += c * 26;
    const r = l, g = l + 1, b = l + 2;
    const m = smoothstep(0.1, 0.6, wt);
    return [lerp(r, 10, m), lerp(g, 20, m), lerp(b, 25, m), 255];
  }

  private paint(res: number, u0: number, v0: number, span: number, fn: (u: number, v: number) => number[]) {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d')!;
    const img = g.createImageData(res, res);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const px = fn(u0 + ((i + 0.5) / res) * span, v0 + ((j + 0.5) / res) * span);
      img.data.set(px, (j * res + i) * 4);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private async paintAsync(res: number, u0: number, v0: number, span: number) {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d')!;
    const img = g.createImageData(res, res);
    const levels = Math.round(28 / Math.sqrt(span));
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        img.data.set(this.terrainPx(u0 + ((i + 0.5) / res) * span, v0 + ((j + 0.5) / res) * span, levels), (j * res + i) * 4);
      }
      if (j % 96 === 95) await new Promise((r) => setTimeout(r, 0));
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  /** Snap the lead machine (and camera) to a pose, e.g. to match another view. */
  setHero(p: Pose) {
    this.hero = { u: p.u, v: p.v, heading: p.heading };
    this.cam = { cx: p.u, cy: p.v };
  }

  private stepHero(dt: number) {
    const w = this.world;
    const goal = this.waypoints[this.heroGoal];
    if (Math.hypot(goal.u - this.hero.u, goal.v - this.hero.v) < 0.012) this.heroGoal = (this.heroGoal + 1) % this.waypoints.length;
    this.plan = planArcs(this.hero, goal, (u, v) => riskAt(w, u, v, this.know.get(u, v)), { count: 11, length: 0.05, steps: 14, spread: 26 });
    const [u1, v1] = this.plan.candidates[this.plan.best].points[2];
    const target = Math.atan2(v1 - this.hero.v, u1 - this.hero.u);
    let dh = Math.atan2(Math.sin(target - this.hero.heading), Math.cos(target - this.hero.heading));
    this.hero.heading += clamp(dh, -2.5 * dt, 2.5 * dt);
    const sp = 0.009 * dt;
    this.hero.u += Math.cos(this.hero.heading) * sp;
    this.hero.v += Math.sin(this.hero.heading) * sp;
    this.know.reveal(this.hero.u + Math.cos(this.hero.heading) * 0.012, this.hero.v + Math.sin(this.hero.heading) * 0.012, 0.032, 0.25);
    if (this.frameNo % 4 === 0) {
      this.trail.push([this.hero.u, this.hero.v]);
      if (this.trail.length > 160) this.trail.shift();
    }
  }

  private poseOf(a: Agent): Pose {
    const n = a.path.length - 1;
    const len = n * 0.008 * 0.375;
    let t = (this.time * a.speed) / Math.max(0.02, len) + a.phase;
    t = t % 2;
    const f = (t < 1 ? t : 2 - t) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const p = a.path[i];
    const q = a.path[i + 1] ?? p;
    const fr = f - i;
    const back = t >= 1 ? Math.PI : 0;
    return { u: lerp(p.u, q.u, fr), v: lerp(p.v, q.v, fr), heading: Math.atan2(q.v - p.v, q.u - p.u) + back };
  }

  private visible(a: Agent, s: ForceState) {
    return a.group === 'others' ? s.others : a.group === 'team' ? s.team : s.network;
  }

  frame(dt: number, s: ForceState) {
    if (!this.ready) return;
    this.time += dt;
    this.frameNo++;
    if (s.move > 0.01) this.stepHero(dt * s.move);
    for (const a of this.agents) {
      a.pose = this.poseOf(a);
      const vis = this.visible(a, s);
      if (vis > 0.3 && this.frameNo % 3 === 0) this.know.reveal(a.pose.u, a.pose.v, a.id === 'uav' ? 0.05 : 0.03, 0.2 * vis);
    }
    if (this.frameNo % 2 === 0) this.know.decay(0.9985);

    const { ctx, W, H } = this;
    const follow = s.follow;
    const tx = lerp(s.cx, this.hero.u, follow);
    const ty = lerp(s.cy, this.hero.v, follow);
    const ease = 1 - Math.exp(-dt * 5);
    this.cam.cx += (tx - this.cam.cx) * ease;
    this.cam.cy += (ty - this.cam.cy) * ease;
    const K = H / s.z;
    const ox = W / 2 - this.cam.cx * K;
    const oy = H / 2 - this.cam.cy * K;
    const X = (u: number) => ox + u * K;
    const Y = (v: number) => oy + v * K;
    const g = clamp(0.55 + (K - 700) / 3600, 0.55, 1.6);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgb(${BG.join(',')})`;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base!, X(0), Y(0), K, K);
    const dPx = K * DETAIL.span;
    if (dPx > this.detail!.width * 0.7) {
      ctx.globalAlpha = smoothstep(this.detail!.width * 0.7, this.detail!.width * 1.1, dPx);
      ctx.drawImage(this.detail!, X(DETAIL.u), Y(DETAIL.v), dPx, dPx);
      ctx.globalAlpha = 1;
    }
    if (s.risk > 0.01) {
      ctx.globalAlpha = s.risk * 0.85;
      ctx.drawImage(this.riskImg, X(0), Y(0), K, K);
      if (dPx > this.riskDetail.width) ctx.drawImage(this.riskDetail, X(DETAIL.u), Y(DETAIL.v), dPx, dPx);
      ctx.globalAlpha = 1;
    }
    if (s.fog > 0.01) {
      const d = this.fogData.data;
      const kd = this.know.data;
      for (let i = 0; i < kd.length; i++) {
        d[i * 4] = BG[0]; d[i * 4 + 1] = BG[1]; d[i * 4 + 2] = BG[2];
        d[i * 4 + 3] = (1 - smoothstep(0.05, 0.6, kd[i])) * 190;
      }
      this.fogImg.getContext('2d')!.putImageData(this.fogData, 0, 0);
      ctx.globalAlpha = s.fog;
      ctx.drawImage(this.fogImg, X(0), Y(0), K, K);
      ctx.globalAlpha = 1;
    }

    // Area of operations frame (visible once zoomed out past the map edge)
    const edge = smoothstep(0.75, 1.0, s.z);
    if (edge > 0.01) {
      ctx.strokeStyle = `rgba(235,233,226,${0.22 * edge})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(X(0), Y(0), K, K);
      ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = `rgba(235,233,226,${0.45 * edge})`;
      ctx.fillText(`AREA OF OPERATIONS · ${WORLD_KM} × ${WORLD_KM} KM`, X(0), Y(0) - 10);
    }

    // Threat envelopes
    if (s.threats > 0.01) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      for (const t of this.world.threats) {
        const r = t.r * K;
        ctx.strokeStyle = `rgba(255,128,64,${0.65 * s.threats})`;
        ctx.fillStyle = `rgba(255,110,40,${0.06 * s.threats})`;
        ctx.beginPath();
        ctx.arc(X(t.u), Y(t.v), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    const mono = (px: number) => `500 ${px}px "IBM Plex Mono", ui-monospace, monospace`;
    const label = (txt: string, x: number, y: number, a: number, color = '235,233,226', px = 10) => {
      if (a < 0.02) return;
      ctx.font = mono(px);
      ctx.fillStyle = `rgba(${color},${a})`;
      ctx.fillText(txt, x, y);
    };

    if (s.annot > 0.01) {
      const t0 = this.world.threats[0];
      if (t0) label('EW / JAMMING', X(t0.u) + t0.r * K + 8, Y(t0.v), 0.9 * s.annot, '255,150,90', 11);
      label('NO GNSS · NO PRIOR MAP · COMMS DEGRADED', W * 0.42, H - 40, 0.75 * s.annot, '235,233,226', 11);
      label('UNOBSERVED', X(this.hero.u) + 0.08 * K, Y(this.hero.v) - 0.06 * K, 0.6 * s.annot);
    }

    // Team links (shared belief)
    const teamA = (a: Agent) => (a.group === 'others' || a.group === 'team' ? s.team : s.network);
    ctx.lineWidth = 1;
    const all = this.agents;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.team !== b.team) continue;
      const alpha = Math.min(teamA(a), this.visible(a, s), this.visible(b, s));
      const d = Math.hypot(a.pose.u - b.pose.u, a.pose.v - b.pose.v);
      if (alpha < 0.02 || d > 0.2) continue;
      ctx.strokeStyle = `rgba(143,216,204,${0.22 * alpha * (1 - d / 0.2)})`;
      ctx.beginPath(); ctx.moveTo(X(a.pose.u), Y(a.pose.v)); ctx.lineTo(X(b.pose.u), Y(b.pose.v)); ctx.stroke();
    }
    // hero participates in team 0
    for (const a of all) {
      if (a.team !== 0) continue;
      const alpha = Math.min(s.team, this.visible(a, s));
      const d = Math.hypot(a.pose.u - this.hero.u, a.pose.v - this.hero.v);
      if (alpha < 0.02 || d > 0.22) continue;
      ctx.strokeStyle = `rgba(143,216,204,${0.22 * alpha * (1 - d / 0.22)})`;
      ctx.beginPath(); ctx.moveTo(X(a.pose.u), Y(a.pose.v)); ctx.lineTo(X(this.hero.u), Y(this.hero.v)); ctx.stroke();
    }

    // Operators: supervision
    const opA = (n: Node) => (n.team === 0 ? s.operator : s.network);
    ctx.save();
    ctx.setLineDash([2, 4]);
    for (const n of this.operators) {
      const a = opA(n);
      if (a < 0.02) continue;
      ctx.strokeStyle = `rgba(235,233,226,${0.3 * a})`;
      const members = all.filter((m) => m.team === n.team);
      const pts = n.team === 0 ? [...members.map((m) => m.pose), this.hero] : members.map((m) => m.pose);
      for (const p of pts) { ctx.beginPath(); ctx.moveTo(X(n.u), Y(n.v)); ctx.lineTo(X(p.u), Y(p.v)); ctx.stroke(); }
    }
    ctx.restore();

    // Uplink: lead machine -> Shunya OS node
    if (s.uplink > 0.01) {
      const ux = X(this.hub.u), uy = Y(this.hub.v), mx = X(this.hero.u), my = Y(this.hero.v);
      ctx.strokeStyle = `rgba(168,230,255,${0.7 * s.uplink})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(ux, uy); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const f = (this.time * 0.3 + i / 4) % 1;
        ctx.fillStyle = `rgba(230,247,255,${s.uplink})`;
        ctx.beginPath(); ctx.arc(lerp(mx, ux, f), lerp(my, uy, f), 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = `rgba(168,230,255,${0.8 * s.uplink * (1 - s.network)})`;
      ctx.beginPath(); ctx.rect(ux - 6, uy - 6, 12, 12); ctx.stroke();
    }

    // Network: operators <-> Shunya OS hub, with moving pulses
    if (s.network > 0.01) {
      const hx = X(this.hub.u), hy = Y(this.hub.v);
      for (const [i, n] of this.operators.entries()) {
        ctx.strokeStyle = `rgba(143,216,204,${0.5 * s.network})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(X(n.u), Y(n.v)); ctx.stroke();
        for (const dir of [0, 1]) {
          const t = (this.time * 0.35 + i * 0.27 + dir * 0.5) % 1;
          const f = dir ? t : 1 - t;
          ctx.fillStyle = dir ? `rgba(143,216,204,${s.network})` : `rgba(235,233,226,${s.network})`;
          ctx.beginPath(); ctx.arc(lerp(hx, X(n.u), f), lerp(hy, Y(n.v), f), 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.strokeStyle = `rgba(143,216,204,${s.network})`;
      ctx.fillStyle = `rgba(8,10,11,${s.network})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.rect(hx - 9, hy - 9, 18, 18); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 18 + Math.sin(this.time * 2) * 2, 0, Math.PI * 2); ctx.stroke();
      label('SHUNYA OS', hx + 28, hy + 4, s.network, '143,216,204', 11);
      const centers = [0, 1, 2].map((t) => {
        const m = all.filter((a) => a.team === t);
        return { u: m.reduce((x, a) => x + a.pose.u, 0) / m.length, v: m.reduce((x, a) => x + a.pose.v, 0) / m.length, n: m.length + (t === 0 ? 1 : 0) };
      });
      centers.forEach((c, t) => label(`TEAM ${t + 1} · ${c.n} MACHINES`, X(c.u) - 50, Y(c.v) - 0.13 * K, 0.7 * s.network));
    }
    for (const n of this.operators) {
      const a = opA(n);
      if (a < 0.02) continue;
      const x = X(n.u), y = Y(n.v);
      ctx.strokeStyle = `rgba(235,233,226,${a})`;
      ctx.fillStyle = `rgba(8,10,11,${a})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(235,233,226,${a})`;
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      label('OPERATOR', x + 14, y + 4, 0.8 * a);
    }

    // Hero: trail, sensing footprint, candidate plans, engine ring
    const hx = X(this.hero.u), hy = Y(this.hero.v);
    ctx.save();
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = 'rgba(235,233,226,0.45)';
    ctx.beginPath();
    this.trail.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.restore();

    const fp = 0.035 * K;
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, fp);
    grad.addColorStop(0, 'rgba(143,216,204,0.16)');
    grad.addColorStop(1, 'rgba(143,216,204,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, fp, this.hero.heading - 1, this.hero.heading + 1); ctx.closePath(); ctx.fill();

    if (s.plans > 0.01) {
      this.plan.candidates.forEach((c, i) => {
        const best = i === this.plan.best;
        const rr = clamp(c.maxRisk * 1.4);
        ctx.strokeStyle = best ? `rgba(235,233,226,${s.plans})` : `rgba(${Math.round(lerp(143, 255, rr))},${Math.round(lerp(216, 128, rr))},${Math.round(lerp(204, 64, rr))},${0.45 * s.plans})`;
        ctx.lineWidth = best ? 2.2 : 1;
        ctx.beginPath();
        c.points.forEach(([u, v], j) => (j ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
        ctx.stroke();
      });
    }

    if (s.engine > 0.01) {
      const R = 74 * g;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.strokeStyle = `rgba(143,216,204,${0.6 * s.engine})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      const steps = ['PERCEIVE', 'BELIEVE', 'ASSESS RISK', 'PLAN', 'ACT'];
      const rot = this.time * 0.5;
      steps.forEach((t, i) => {
        const a = rot + (i / steps.length) * Math.PI * 2;
        const on = (Math.floor(this.time * 2) % steps.length) === i;
        ctx.fillStyle = on ? `rgba(143,216,204,${s.engine})` : `rgba(8,10,11,${s.engine})`;
        ctx.strokeStyle = `rgba(143,216,204,${s.engine})`;
        ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = mono(10);
        ctx.fillStyle = `rgba(235,233,226,${(on ? 0.95 : 0.55) * s.engine})`;
        const lx = Math.cos(a) * (R + 12);
        ctx.textAlign = lx < -4 ? 'right' : lx > 4 ? 'left' : 'center';
        ctx.fillText(t, lx, Math.sin(a) * (R + 12) + 4);
      });
      ctx.restore();
      ctx.textAlign = 'left';
    }

    // Agents
    const typeLabel: Record<EmbodimentId, string> = { ugv: 'GROUND', uav: 'AIR', legged: 'LEGGED', maritime: 'MARITIME' };
    for (const a of all) {
      const vis = this.visible(a, s);
      if (vis < 0.02) continue;
      const x = X(a.pose.u), y = Y(a.pose.v);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      ctx.fillStyle = `rgba(8,10,11,${0.9 * vis})`;
      ctx.beginPath(); ctx.arc(x, y, 13 * g, 0, Math.PI * 2); ctx.fill();
      if (s.engine > 0.05 && a.group === 'others') {
        ctx.strokeStyle = `rgba(143,216,204,${0.6 * s.engine * vis})`;
        ctx.beginPath(); ctx.arc(x, y, 22 * g, 0, Math.PI * 2); ctx.stroke();
      }
      drawGlyph(ctx, PLAN_GLYPHS[a.id], x, y, a.pose.heading, 0.85 * g, `rgba(235,233,226,${vis})`, 1.3);
      if (a.group === 'others') label(typeLabel[a.id], x + 18 * g, y - 12 * g, 0.75 * vis * (1 - s.network));
    }
    ctx.fillStyle = 'rgba(8,10,11,0.9)';
    ctx.beginPath(); ctx.arc(hx, hy, 14 * g, 0, Math.PI * 2); ctx.fill();
    drawGlyph(ctx, PLAN_GLYPHS.ugv, hx, hy, this.hero.heading, 0.95 * g, '#ebe9e2', 1.5);
    if (s.others > 0.05) label('GROUND', hx + 18 * g, hy - 12 * g, 0.75 * s.others * (1 - s.network));
  }

  /** Map scale (km per pixel) for the HUD scale bar. */
  kmPerPx(s: ForceState) {
    return (WORLD_KM * s.z) / this.H;
  }

  counts(s: ForceState) {
    const on = (x: number) => x > 0.5;
    const m = 1 + this.agents.filter((a) => on(this.visible(a, s))).length;
    const ops = this.operators.filter((n) => on(n.team === 0 ? s.operator : s.network)).length;
    const teams = on(s.network) ? 3 : 1;
    return { machines: m, operators: ops, teams };
  }
}
