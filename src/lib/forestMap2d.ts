/** Canvas fallback for under-canopy reconnaissance, using the same forest model. */
import { fitCanvas } from './motion';
import {
  createForestRecon, forestHeight, forestRisk, forestState, forestScoutPose, forestTeamPose,
  forestObservedAt, forestObservationSamples, type ForestRecon,
} from './forestRecon';

export class ForestMap2D {
  private ctx: CanvasRenderingContext2D;
  private model: ForestRecon;
  private raster = document.createElement('canvas');
  private image: ImageData;
  private risk: Float32Array;
  private seen: Float32Array;
  private samples: ReturnType<typeof forestObservationSamples>;
  private lastProgress = -1;
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, opts: { model?: ForestRecon } = {}) {
    this.ctx = canvas.getContext('2d')!;
    this.model = opts.model ?? createForestRecon();
    this.samples = forestObservationSamples(this.model);
    this.raster.width = 96; this.raster.height = 136;
    this.image = this.raster.getContext('2d')!.createImageData(96, 136);
    this.risk = new Float32Array(96 * 136); this.seen = new Float32Array(this.risk.length);
    for (let j = 0; j < 136; j++) for (let i = 0; i < 96; i++) {
      const x = i / 96 * 76 - 38, z = j / 136 * 108 - 5, k = j * 96 + i;
      this.risk[k] = forestRisk(this.model, x, z); this.seen[k] = forestObservedAt(this.samples, x, z);
    }
  }

  resize() {
    const { w, h, dpr } = fitCanvas(this.canvas, 1.5);
    this.w = w; this.h = h; this.dpr = dpr; this.lastProgress = -1;
  }

  frame(_dt: number, progress: number) {
    if (Math.abs(progress - this.lastProgress) < 0.001) return;
    this.lastProgress = progress;
    const { model, ctx, w, h } = this, state = forestState(progress), pose = forestScoutPose(model, progress);
    const vertical = w < h, pw = vertical ? w : w / 2, ph = vertical ? h / 2 : h;
    const a = forestScoutPose(model, Math.max(0.101, Math.min(0.798, progress - 0.002)));
    const b = forestScoutPose(model, Math.max(0.103, Math.min(0.8, progress + 0.002)));
    const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0c1719'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
    const floor = ctx.createLinearGradient(0, ph * 0.4, 0, ph);
    floor.addColorStop(0, '#102023'); floor.addColorStop(1, '#444332'); ctx.fillStyle = floor; ctx.fillRect(0, ph * 0.4, pw, ph);
    const focal = ph * 0.75;
    const visible = model.trees.map(tree => {
      const dx = tree.x - pose.x, dz = tree.z - pose.z;
      return { tree, side: dx * Math.cos(heading) + dz * Math.sin(heading), depth: dx * Math.sin(heading) - dz * Math.cos(heading) };
    }).filter(t => t.depth > 0.7 && t.depth < 65).sort((a, b) => b.depth - a.depth);
    for (const { tree, side, depth } of visible) {
      const x = pw / 2 + side / depth * focal, radius = Math.max(1, tree.radius / depth * focal);
      if (x + radius < 0 || x - radius > pw) continue;
      const base = ph / 2 + (pose.y - forestHeight(tree.x, tree.z)) / depth * focal;
      const top = base - tree.height / depth * focal, fog = Math.exp(-depth * 0.035);
      ctx.fillStyle = `rgb(${Math.round(12 + fog * 53)},${Math.round(23 + fog * 45)},${Math.round(25 + fog * 29)})`;
      ctx.fillRect(x - radius, top, radius * 2, base - top);
      ctx.strokeStyle = `rgba(121,126,99,${fog * 0.18})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - radius * 0.4, base); ctx.lineTo(x - radius * 0.15, top); ctx.stroke();
      ctx.fillStyle = `rgba(24,48,30,${fog * 0.8})`;
      for (let j = 0; j < 4; j++) {
        ctx.beginPath(); ctx.ellipse(x + Math.sin(tree.x + j) * radius * 2, top + (base - top) * (0.12 + j * 0.035),
          tree.crown / depth * focal, tree.crown / depth * focal * 0.4, j * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    const vignette = ctx.createRadialGradient(pw / 2, ph / 2, pw * 0.12, pw / 2, ph / 2, Math.max(pw, ph) * 0.7);
    vignette.addColorStop(0, '#00000000'); vignette.addColorStop(1, '#000000aa'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, pw, ph);
    ctx.restore();
    const ox = vertical ? 0 : pw, oy = vertical ? ph : 0;
    ctx.fillStyle = '#060b0d'; ctx.fillRect(ox, oy, pw, ph);
    const scale = Math.min(pw * 0.9 / 76, ph * 0.85 / 108);
    const mx = ox + (pw - 76 * scale) / 2, my = oy + (ph - 108 * scale) / 2;
    const X = (x: number) => mx + (x + 38) * scale, Z = (z: number) => my + (z + 5) * scale;
    const pixels = this.image.data;
    for (let i = 0; i < this.risk.length; i++) {
      const known = this.seen[i] <= progress, risk = this.risk[i], hatch = ((i % 96 + Math.floor(i / 96)) % 7 === 0) ? 6 : 0;
      pixels.set(known ? [22 + risk * 120, 48 - risk * 15, 40 - risk * 20, 255] : [7 + hatch, 11 + hatch, 12 + hatch, 255], i * 4);
    }
    this.raster.getContext('2d')!.putImageData(this.image, 0, 0);
    ctx.drawImage(this.raster, mx, my, 76 * scale, 108 * scale);
    for (const tree of model.trees) {
      ctx.fillStyle = forestObservedAt(this.samples, tree.x, tree.z) <= progress ? '#405e49' : '#10191a';
      ctx.beginPath(); ctx.arc(X(tree.x), Z(tree.z), Math.max(1.2, tree.radius * scale), 0, Math.PI * 2); ctx.fill();
    }
    model.routes.forEach((route, index) => {
      const best = route === model.best, count = best ? Math.floor(25 + (route.points.length - 25) * state.scouting) : route.points.length;
      ctx.globalAlpha = state.compare * (best ? 0.9 : 0.4 - state.recommended * 0.2);
      ctx.strokeStyle = ['#c27653', '#c9a668', '#a9d7c4'][index]; ctx.lineWidth = best ? 2 : 1.2;
      ctx.setLineDash(best && state.recommended > 0.5 ? [] : [4, 3]); ctx.beginPath();
      route.points.slice(0, count).forEach((p, i) => i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    model.hazards.forEach(hazard => {
      if (forestObservedAt(this.samples, hazard.x, hazard.z) > progress) return;
      ctx.strokeStyle = hazard.kind === 'slope' ? '#c9a668' : '#c27653';
      ctx.beginPath(); ctx.arc(X(hazard.x), Z(hazard.z), hazard.radius * scale, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.strokeStyle = '#d4e3d8'; ctx.lineWidth = 1.4;
    for (const dx of [-3, 3]) for (const dz of [-3, 3]) { ctx.beginPath(); ctx.arc(X(pose.x) + dx, Z(pose.z) + dz, 2.7, 0, Math.PI * 2); ctx.stroke(); }
    const team = forestTeamPose(model, progress); ctx.fillStyle = '#dfdccb';
    for (let i = -1; i <= 1; i++) ctx.fillRect(X(team.x + i * 1.1) - 2, Z(team.z + 3) - 2, 4, 4);
  }
}
