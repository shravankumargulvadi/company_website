/**
 * Top-down Canvas 2D view of the passage risk map. Used as the no-WebGL
 * fallback for Candidate A's underground chapter and as a proof placeholder.
 */
import { cellUncertainty, passageRamp, poseAtS, shownRisk, type Passage } from './passage';

export class PassageMap2D {
  private ctx: CanvasRenderingContext2D;
  private buf = document.createElement('canvas');
  private img: ImageData;
  private hatch: CanvasPattern | null;

  constructor(private canvas: HTMLCanvasElement, private P: Passage) {
    this.ctx = canvas.getContext('2d')!;
    this.buf.width = this.buf.height = P.n;
    this.img = this.buf.getContext('2d')!.createImageData(P.n, P.n);
    const h = document.createElement('canvas');
    h.width = h.height = 8;
    const hc = h.getContext('2d')!;
    hc.fillStyle = '#2b2d31';
    hc.fillRect(0, 0, 8, 8);
    hc.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    hc.beginPath();
    hc.moveTo(0, 8);
    hc.lineTo(8, 0);
    hc.stroke();
    this.hatch = this.ctx.createPattern(h, 'repeat');
  }

  draw(s: number, time = 0) {
    const { ctx, P } = this;
    const W = this.canvas.width;
    const Hc = this.canvas.height;
    const n = P.n;
    ctx.fillStyle = '#232528';
    ctx.fillRect(0, 0, W, Hc);
    const size = Math.min(W, Hc) * 0.94;
    const ox = (W - size) / 2;
    const oy = (Hc - size) / 2;
    const sc = size / P.extent;
    const X = (x: number) => ox + x * sc;
    const Y = (z: number) => oy + z * sc;

    if (this.hatch) {
      ctx.fillStyle = this.hatch;
      ctx.fillRect(ox, oy, size, size);
    }

    const d = this.img.data;
    for (let k = 0; k < n * n; k++) {
      const u = cellUncertainty(P, k, s);
      const o = k * 4;
      if (u < 0) {
        d[o + 3] = 0;
        continue;
      }
      const i = k % n;
      const gx = P.height[Math.min(k + 1, n * n - 1)] - P.height[Math.max(k - 1, 0)];
      const gz = P.height[Math.min(k + n, n * n - 1)] - P.height[Math.max(k - n, 0)];
      const shade = i === 0 || i === n - 1 ? 1 : Math.min(1.15, Math.max(0.55, 0.9 - gx * 0.35 - gz * 0.25));
      const [r, g, b] = passageRamp(shownRisk(P.risk[k], u));
      d[o] = r * shade;
      d[o + 1] = g * shade;
      d[o + 2] = b * shade;
      d[o + 3] = 255;
    }
    this.buf.getContext('2d')!.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, ox, oy, size, size);

    const pose = poseAtS(P, s);
    const idx = Math.min(P.path.length - 1, Math.floor(s / P.ds));
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, sc * 0.07);
    ctx.strokeStyle = 'rgba(235, 231, 222, 0.6)';
    ctx.beginPath();
    for (let i = 0; i <= idx; i += 2) {
      const p = P.path[i];
      i === 0 ? ctx.moveTo(X(p.x), Y(p.z)) : ctx.lineTo(X(p.x), Y(p.z));
    }
    ctx.lineTo(X(pose.x), Y(pose.z));
    ctx.stroke();

    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = Math.max(1.5, sc * 0.1);
    ctx.beginPath();
    ctx.moveTo(X(pose.x), Y(pose.z));
    for (let i = idx + 1; i < Math.min(P.path.length, idx + 40); i++) ctx.lineTo(X(P.path[i].x), Y(P.path[i].z));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(168, 230, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(pose.x), Y(pose.z), P.range * sc, 0, Math.PI * 2);
    ctx.stroke();
    const a = time * 2.2;
    ctx.strokeStyle = 'rgba(168, 230, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(X(pose.x), Y(pose.z));
    ctx.lineTo(X(pose.x + Math.cos(a) * P.range), Y(pose.z + Math.sin(a) * P.range));
    ctx.stroke();

    const m = Math.max(5, sc * 0.45);
    ctx.save();
    ctx.translate(X(pose.x), Y(pose.z));
    ctx.rotate(pose.heading);
    ctx.fillStyle = '#060708';
    ctx.strokeStyle = '#ebe7de';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(m, 0);
    ctx.lineTo(-m * 0.7, m * 0.6);
    ctx.lineTo(-m * 0.35, 0);
    ctx.lineTo(-m * 0.7, -m * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
