/**
 * Lightweight top-down 2D "simulation" renderer. Used as a stand-in for real
 * simulation footage (proof sections) and as a no-WebGL fallback.
 */
import {
  KnowledgeMap,
  PROFILES,
  planArcs,
  poseAt,
  riskAt,
  rollout,
  sample,
  smoothstep,
  type Pose,
  type World,
} from './world';
import { PLAN_GLYPHS } from './glyphs';

export type SimVariant = 'plan' | 'risk' | 'belief';
type RGBA = [number, number, number, number];

export function paintField(res: number, fn: (u: number, v: number) => RGBA): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const [r, g, b, a] = fn(i / (res - 1), j / (res - 1));
      const k = (j * res + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function hillshade(w: World, u: number, v: number): number {
  const e = 1.5 / w.size;
  const dx = sample(w.height, w.size, u + e, v) - sample(w.height, w.size, u - e, v);
  const dy = sample(w.height, w.size, u, v + e) - sample(w.height, w.size, u, v - e);
  return Math.min(1, Math.max(0, 0.55 - dx * 3.2 - dy * 2.2));
}

export function contourLine(h: number, levels = 16, width = 0.08): number {
  const f = (h * 0.5 + 0.5) * levels;
  const d = Math.abs(f - Math.round(f));
  return 1 - smoothstep(0, width, d);
}

/** Restrained risk ramp: dark → ochre → signal orange. */
export function riskRamp(t: number): [number, number, number] {
  const a = [28, 18, 10];
  const b = [150, 82, 24];
  const c = [255, 120, 48];
  const m = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
  const [p, q] = t < 0.55 ? [a, b] : [b, c];
  return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
}

export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  d: string,
  x: number,
  y: number,
  heading: number,
  scale: number,
  stroke: string,
  lineWidth = 1.4,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.lineWidth = lineWidth / scale;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

export class SimView {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private riskImg: HTMLCanvasElement;
  private knowledge = new KnowledgeMap(96);
  private kCanvas = document.createElement('canvas');
  private kImg: ImageData;
  private layer = document.createElement('canvas');
  private path: Pose[];
  private goal = { u: 0.86, v: 0.2 };
  private lastPhase = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private variant: SimVariant = 'plan',
    private period = 16,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const w = world;
    this.base = paintField(320, (u, v) => {
      const h = sample(w.height, w.size, u, v);
      const s = hillshade(w, u, v);
      const c = contourLine(h, 18, 0.07) * 0.22;
      const wa = sample(w.water, w.size, u, v);
      const g = 14 + s * 38 + c * 120;
      return [g * (1 - wa * 0.4), g * (1 - wa * 0.2), g + wa * 18, 255];
    });
    this.riskImg = paintField(256, (u, v) => {
      const r = riskAt(w, u, v, 1, PROFILES.ugv);
      const [cr, cg, cb] = riskRamp(r);
      return [cr, cg, cb, 60 + r * 180];
    });
    this.kCanvas.width = this.kCanvas.height = this.knowledge.size;
    this.kImg = this.kCanvas.getContext('2d')!.createImageData(this.knowledge.size, this.knowledge.size);
    this.path = rollout({ u: 0.12, v: 0.84, heading: -0.6 }, this.goal, (u, v) => riskAt(w, u, v, 1), 90, {
      execute: 3,
    });
  }

  private updateKnowledgeCanvas() {
    const { data } = this.knowledge;
    const px = this.kImg.data;
    for (let k = 0; k < data.length; k++) {
      px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = 255;
      px[k * 4 + 3] = data[k] * 255;
    }
    this.kCanvas.getContext('2d')!.putImageData(this.kImg, 0, 0);
  }

  draw(time: number) {
    const { ctx, canvas, world } = this;
    const W = canvas.width;
    const H = canvas.height;
    const S = Math.max(W, H) * 1.05;
    const ox = (W - S) / 2;
    const oy = (H - S) / 2;
    const X = (u: number) => ox + u * S;
    const Y = (v: number) => oy + v * S;

    const phase = (time / this.period) % 1;
    if (phase < this.lastPhase) this.knowledge.clear();
    this.lastPhase = phase;
    const t = Math.min(1, phase * 1.15);
    const pose = poseAt(this.path, t);
    this.knowledge.reveal(pose.u, pose.v, 0.12, 0.25);
    this.updateKnowledgeCanvas();

    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, ox, oy, S, S);

    if (this.layer.width !== W || this.layer.height !== H) {
      this.layer.width = W;
      this.layer.height = H;
    }
    const l = this.layer.getContext('2d')!;
    l.clearRect(0, 0, W, H);
    l.globalCompositeOperation = 'source-over';

    if (this.variant === 'belief') {
      l.fillStyle = 'rgba(6,7,9,0.9)';
      l.fillRect(0, 0, W, H);
      l.fillStyle = 'rgba(160,200,230,0.18)';
      const step = Math.max(6, Math.round(W / 90));
      for (let y = 0; y < H; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < W; x += step) l.fillRect(x, y, 1.2, 1.2);
      l.globalCompositeOperation = 'destination-out';
      l.drawImage(this.kCanvas, ox, oy, S, S);
    } else {
      l.drawImage(this.riskImg, ox, oy, S, S);
      l.globalCompositeOperation = 'destination-in';
      l.drawImage(this.kCanvas, ox, oy, S, S);
      if (this.variant === 'plan') l.globalAlpha = 1;
    }
    l.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.variant === 'plan' ? 0.6 : 1;
    ctx.drawImage(this.layer, 0, 0);
    ctx.globalAlpha = 1;

    const dpr = W / canvas.clientWidth || 1;
    // trail
    ctx.beginPath();
    const n = Math.floor(t * (this.path.length - 1));
    for (let i = 0; i <= n; i++) {
      const p = this.path[i];
      i ? ctx.lineTo(X(p.u), Y(p.v)) : ctx.moveTo(X(p.u), Y(p.v));
    }
    ctx.lineTo(X(pose.u), Y(pose.v));
    ctx.strokeStyle = 'rgba(235,231,222,0.5)';
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.variant !== 'belief') {
      const { candidates, best } = planArcs(
        pose,
        this.goal,
        (u, v) => riskAt(world, u, v, this.knowledge.get(u, v)),
        { count: 15, length: 0.2 },
      );
      candidates.forEach((c, i) => {
        if (i === best) return;
        ctx.beginPath();
        c.points.forEach(([u, v], k) => (k ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
        ctx.strokeStyle = `rgba(235,231,222,${0.1 + (1 - c.maxRisk) * 0.25})`;
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      });
      const b = candidates[best];
      ctx.beginPath();
      b.points.forEach(([u, v], k) => (k ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
      ctx.strokeStyle = '#a8e6ff';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }

    // goal
    ctx.strokeStyle = 'rgba(235,231,222,0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.arc(X(this.goal.u), Y(this.goal.v), 7 * dpr, 0, Math.PI * 2);
    ctx.stroke();

    drawGlyph(ctx, PLAN_GLYPHS.ugv, X(pose.u), Y(pose.v), pose.heading, 0.9 * dpr, '#ebe7de', 1.4 * dpr);
  }
}
