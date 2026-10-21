/** Canvas fallback for the Industry & exploration chapter: the risk map only. */
import { fitCanvas } from './motion';
import { FIELD_DEMOS, fieldGrid, fieldMoment, fieldRoutes, type FieldDemo, type FieldGrid, type FieldId, type FieldRoutes, type V2 } from './fieldDemo';

const RAMP = [[58, 72, 82], [168, 98, 36], [255, 124, 52]];
const ramp = (t: number) => {
  const [a, b, u] = t < 0.5 ? [RAMP[0], RAMP[1], t / 0.5] : [RAMP[1], RAMP[2], (t - 0.5) / 0.5];
  return a.map((v, i) => v + (b[i] - v) * u);
};

export class FieldMap2D {
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement('canvas');
  private octx: CanvasRenderingContext2D;
  private img!: ImageData;
  private cache = new Map<FieldId, { d: FieldDemo; r: FieldRoutes; g: FieldGrid }>();
  private cur!: { d: FieldDemo; r: FieldRoutes; g: FieldGrid };
  private rect = { x: 0, y: 0, s: 1 };
  private vertical = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.octx = this.off.getContext('2d')!;
    this.setDemo('haul');
  }

  setDemo(id: FieldId) {
    let c = this.cache.get(id);
    if (!c) {
      const d = FIELD_DEMOS[id]();
      const r = fieldRoutes(d);
      c = { d, r, g: fieldGrid(d, r, 100) };
      this.cache.set(id, c);
    }
    this.cur = c;
    this.off.width = this.off.height = c.g.R + 1;
    this.img = this.octx.createImageData(c.g.R + 1, c.g.R + 1);
  }

  resize() {
    const { w, h } = fitCanvas(this.canvas);
    this.vertical = w / h < 1;
    const [vx, vy, vw, vh] = this.vertical ? [0, h / 2, w, h / 2] : [w / 2, 0, w / 2, h];
    const s = Math.min(vw, vh) * 0.78;
    this.rect = { x: vx + (vw - s) / 2, y: vy + (vh - s) / 2, s };
  }

  anchor(): [number, number] {
    return this.pt(this.cur.d.hazardAt);
  }

  private pt([x, z]: V2): [number, number] {
    const { d } = this.cur;
    return [this.rect.x + (x / d.extent) * this.rect.s, this.rect.y + (z / d.extent) * this.rect.s];
  }

  frame(_dt: number, p: number) {
    const { d, r, g } = this.cur;
    const m = fieldMoment(p, r.fork);
    const px = this.img.data;
    for (let k = 0; k < g.seen.length; k++) {
      let c: number[];
      if (g.seen[k] > m.s) {
        const hatch = (Math.floor((g.xs[k] + g.zs[k]) * 1.1) % 3) === 0;
        c = hatch ? [40, 26, 14] : [11, 12, 14];
      } else {
        c = ramp(g.risk[k]);
        const hz = Math.min(1, g.haz[k] * m.detect * 1.4) * 0.92;
        c = c.map((v, i) => v + ([255, 61, 31][i] - v) * hz);
        const u = Math.min(0.6, g.unc[k] * 0.75);
        c = c.map((v, i) => v + ([158, 115, 255][i] - v) * u);
      }
      px.set([c[0], c[1], c[2], 255], k * 4);
    }
    this.octx.putImageData(this.img, 0, 0);
    const { ctx, canvas } = this;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, this.rect.x, this.rect.y, this.rect.s, this.rect.s);
    const path = (pts: V2[], style: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(...this.pt(q)) : ctx.moveTo(...this.pt(q))));
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    path([...r.main, ...r.planned.slice(1)], d.blocked && m.decided > 0.5 ? 'rgba(255,90,60,0.5)' : 'rgba(235,231,222,0.7)', 1.5, [6, 5]);
    path(r.detour, `rgba(127,224,192,${(m.detect * (0.35 + 0.65 * m.decided)).toFixed(2)})`, 2);
    const dist = m.s * r.track.length;
    const n = Math.max(1, Math.round(m.s * (r.track.pts.length - 1)) + 1);
    path(r.track.pts.slice(0, n), '#ffb347', 2.5);
    const [x, y] = this.pt(r.track.at(dist));
    ctx.beginPath();
    ctx.arc(x, y, (d.sensor / d.extent) * this.rect.s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,179,71,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb347';
    ctx.fill();
    return m;
  }
}
