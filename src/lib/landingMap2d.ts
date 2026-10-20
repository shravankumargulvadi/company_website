/** Canvas fallback: low-light gear camera approximation and sampled risk map. */
import { createLandingAssessment, landingHeight, landingSurface, landingPose, landingState, sampleLandingTrajectories } from './landing';
import { fitCanvas } from './motion';

const COLORS = ['#ff775a', '#ffbd64', '#a8e6ff'];

export class LandingMap2D {
  private ctx: CanvasRenderingContext2D;
  private terrain = document.createElement('canvas');
  private assessment = createLandingAssessment();
  private w = 1;
  private h = 1;
  private dpr = 1;
  private sampleCount: number;
  private lastProgress = -1;
  private dirty = true;

  constructor(private canvas: HTMLCanvasElement, opts: { sampleCount?: number } = {}) {
    this.ctx = canvas.getContext('2d')!;
    this.sampleCount = opts.sampleCount ?? 64;
    this.terrain.width = 120;
    this.terrain.height = 180;
    const g = this.terrain.getContext('2d')!;
    const img = g.createImageData(120, 180);
    for (let j = 0; j < 180; j++) for (let i = 0; i < 120; i++) {
      const risk = landingSurface(i - 60, j - 80).risk;
      img.data.set([20 + risk * 120, 48 - risk * 20, 46 - risk * 28, 255], (j * 120 + i) * 4);
    }
    g.putImageData(img, 0, 0);
  }

  resize() {
    const { w, h, dpr } = fitCanvas(this.canvas, 1.5);
    this.w = w; this.h = h; this.dpr = dpr;
    this.dirty = true;
  }

  frame(_dt: number, progress: number) {
    if (!this.dirty && Math.abs(progress - this.lastProgress) < 0.001) return;
    this.dirty = false;
    this.lastProgress = progress;
    const { ctx, w, h, assessment } = this;
    const state = landingState(progress);
    const pose = landingPose(assessment.best, progress);
    const vertical = w < h;
    const pw = vertical ? w : w / 2, ph = vertical ? h / 2 : h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b1118'; ctx.fillRect(0, 0, pw, ph);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
    const index = Math.min(assessment.best.points.length - 2, Math.floor(state.flight * (assessment.best.points.length - 1)));
    const a = assessment.best.points[index], b = assessment.best.points[index + 1];
    const heading = state.flight < 1 ? Math.atan2(b.x - a.x, -(b.z - a.z)) : 0;
    const pitch = 0.42;
    const focal = ph / (2 * Math.tan(76 * Math.PI / 360));
    const project = (side: number, distance: number) => {
      const x = pose.x + side * Math.cos(heading) + distance * Math.sin(heading);
      const z = pose.z + side * Math.sin(heading) - distance * Math.cos(heading);
      const y = landingHeight(x, z) - pose.y + 0.65;
      const depth = Math.max(0.2, distance * Math.cos(pitch) - y * Math.sin(pitch));
      return { x: pw / 2 + side / depth * focal, y: ph / 2 - (y * Math.cos(pitch) + distance * Math.sin(pitch)) / depth * focal };
    };
    // A rough perspective height field under a short landing-light cone.
    for (let row = 45; row >= 0; row--) {
      const near = 0.7 + row ** 1.35 * 0.32, far = 0.7 + (row + 1) ** 1.35 * 0.32;
      for (let col = -22; col < 22; col++) {
        const side = col * 1.25;
        const quad = [project(side, near), project(side + 1.25, near), project(side + 1.25, far), project(side, far)];
        const haze = Math.exp(-((near * 0.032) ** 2));
        const beam = Math.exp(-((side / Math.max(2, near * 0.55)) ** 2));
        const grain = Math.sin((pose.x + side) * 13.7 + (pose.z - near) * 21.3) * 5;
        const light = (18 + beam * 52 / (1 + near * 0.025) + grain) * haze;
        ctx.fillStyle = `rgb(${Math.round(11 + light)},${Math.round(16 + light * 0.96)},${Math.round(21 + light * 0.8)})`;
        ctx.beginPath(); quad.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill();
      }
    }
    // Fixed undercarriage silhouettes frame the moving ground.
    for (const side of [-1, 1]) {
      const x = pw * (side < 0 ? 0.06 : 0.94);
      ctx.strokeStyle = '#30383a'; ctx.lineWidth = Math.max(4, pw * 0.009);
      ctx.beginPath(); ctx.moveTo(pw * (side < 0 ? 0.18 : 0.82), -5); ctx.lineTo(x, ph * 0.24); ctx.stroke();
      ctx.fillStyle = '#080c0e'; ctx.beginPath(); ctx.ellipse(x, ph * 0.27, pw * 0.03, ph * 0.07, side * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    const vignette = ctx.createRadialGradient(pw / 2, ph * 0.45, pw * 0.12, pw / 2, ph / 2, Math.max(pw, ph) * 0.7);
    vignette.addColorStop(0, '#00000000'); vignette.addColorStop(1, '#000000aa');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, pw, ph); ctx.restore();

    const ox = vertical ? 0 : pw, oy = vertical ? ph : 0;
    ctx.fillStyle = '#050708'; ctx.fillRect(ox, oy, pw, ph);
    const scale = Math.min(pw * 0.84 / 120, ph * 0.76 / 180);
    const mx = ox + (pw - 120 * scale) / 2, my = oy + (ph - 180 * scale) / 2;
    ctx.drawImage(this.terrain, mx, my, 120 * scale, 180 * scale);
    ctx.fillStyle = '#0a1012'; ctx.fillRect(mx, my, 120 * scale, (1 - state.scan) * 180 * scale);
    const px = (x: number) => mx + (x + 60) * scale, py = (z: number) => my + (z + 80) * scale;
    const samples = sampleLandingTrajectories(assessment, progress, this.sampleCount).rollouts;
    const maxWeight = Math.max(...samples.map(r => r.weight), 1e-9);
    for (const sample of samples) {
      const importance = Math.sqrt(sample.weight / maxWeight);
      ctx.globalAlpha = state.compare * (0.045 + importance * 0.25);
      ctx.strokeStyle = importance > 0.3 ? '#9bd2c6' : '#9d6244';
      ctx.lineWidth = 0.8; ctx.beginPath();
      sample.points.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z)));
      ctx.stroke();
    }
    assessment.routes.forEach((route, index) => {
      ctx.globalAlpha = state.compare * (route === assessment.best ? 1 : 1 - state.decided * 0.7);
      ctx.strokeStyle = COLORS[index]; ctx.lineWidth = route === assessment.best ? 2.4 : 1.4;
      ctx.setLineDash(route === assessment.best && state.decided > 0.5 ? [] : [5, 4]);
      ctx.beginPath(); route.points.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))); ctx.stroke();
      ctx.strokeRect(px(route.touchdown.x - 4), py(-45), 8 * scale, 23 * scale);
    });
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.fillStyle = '#e5e7df';
    ctx.beginPath(); ctx.moveTo(px(pose.x), py(pose.z) - 8); ctx.lineTo(px(pose.x) + 5, py(pose.z) + 5);
    ctx.lineTo(px(pose.x) - 5, py(pose.z) + 5); ctx.closePath(); ctx.fill();
  }
}
