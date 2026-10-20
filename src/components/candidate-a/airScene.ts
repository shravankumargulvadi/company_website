/**
 * Candidate A — Fieldcore OS, air tab. A fixed-wing machine flies low through a
 * canyon, picks up a radar on its planned branch and re-plans into the other one,
 * keeping terrain between itself and the emitter. Same split layout as DeepScene:
 * chase camera on one side, risk map on the other. Driven by flight progress `s`.
 */
import * as THREE from 'three';
import { createNoise2D, fbm } from '../../lib/noise';

type V2 = [number, number];
const E = 60;
const RIM = 9;
const ALT = 3.4;
const RADAR_R = 17;
const RADAR = { x: 45, z: 9 };
const MAIN: V2[] = [[30, 64], [30.5, 52], [28.5, 41], [30, 31]];
const BR_A: V2[] = [[30, 31], [35, 22], [41, 12], [45.5, -4]];
const BR_B: V2[] = [[30, 31], [24.5, 22.5], [18, 13], [14, -4]];

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function catmull(ctrl: V2[], step = 0.5): V2[] {
  const c = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: V2[] = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const f = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

function distTo(poly: V2[], x: number, z: number) {
  let best = 1e9;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

class Track {
  pts: THREE.Vector3[];
  cum: number[] = [0];
  length: number;
  constructor(poly: V2[]) {
    this.pts = poly.map(([x, z]) => new THREE.Vector3(x, ALT, z));
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  at(d: number) {
    d = Math.min(this.length, Math.max(0, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const t = (d - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    return this.pts[i - 1].clone().lerp(this.pts[i], t);
  }
  heading(d: number) {
    const a = this.at(d - 0.6);
    const b = this.at(d + 0.6);
    return Math.atan2(b.z - a.z, b.x - a.x);
  }
}

const MAP_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const MAP_FRAG = /* glsl */ `
  uniform float uDetect;
  uniform vec2 uRadar;
  uniform float uR;
  uniform float uRim;
  varying vec3 vW;
  float aaLine(float x) {
    float d = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-4);
    return 1.0 - clamp(d, 0.0, 1.0);
  }
  void main() {
    vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
    float h = clamp(vW.y / uRim, 0.0, 1.2);
    vec3 col = mix(vec3(0.05, 0.06, 0.07), vec3(0.3, 0.32, 0.34), h);
    col *= 0.55 + 0.6 * clamp(dot(N, normalize(vec3(-0.5, 0.8, 0.3))), 0.0, 1.0);
    col += vec3(0.6, 0.66, 0.7) * aaLine(vW.y * 0.9) * 0.1;
    float d = distance(vW.xz, uRadar);
    float cover = (1.0 - smoothstep(uR * 0.8, uR, d)) * smoothstep(1.5, 5.0, vW.y + d * 0.12);
    col = mix(col, vec3(1.0, 0.22, 0.14) * (0.45 + 0.55 * h), cover * uDetect * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface AirView {
  detect?: number;
  decided?: number;
}

export class AirScene {
  private renderer: THREE.WebGLRenderer;
  private fpv = new THREE.Scene();
  private map = new THREE.Scene();
  private fpvCam = new THREE.PerspectiveCamera(58, 1, 0.1, 160);
  private mapCam = new THREE.PerspectiveCamera(30, 1, 1, 400);
  private plane = new THREE.Group();
  private marker = new THREE.Group();
  private flight: Track;
  private aPts: V2[];
  private bPts: V2[];
  private mapMat: THREE.ShaderMaterial;
  private domes: THREE.Mesh[] = [];
  private sweep: THREE.Line;
  private plannedLine: THREE.Line;
  private altLine: THREE.Line;
  private trail: THREE.Line;
  private vertical = false;
  private w = 1;
  private h = 1;
  private time = 0;
  private roll = 0;

  constructor(private canvas: HTMLCanvasElement, opts: { lowPower?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.5));

    const mainPts = catmull(MAIN);
    this.aPts = catmull(BR_A);
    this.bPts = catmull(BR_B);
    this.flight = new Track([...mainPts, ...this.bPts.slice(1)]);

    /* canyon terrain */
    const n1 = createNoise2D(5);
    const n2 = createNoise2D(17);
    const seg = opts.lowPower ? 140 : 200;
    const geo = new THREE.PlaneGeometry(E, E + 8, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(E / 2, 0, E / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const polys = [mainPts, this.aPts, this.bPts];
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const d = Math.min(...polys.map((p) => distTo(p, x, z)));
      const wall = sstep(2.0, 7.0, d + fbm(n2, x * 0.15, z * 0.15, 2) * 1.2);
      const ledges = Math.round(wall * 4) / 4;
      let y = RIM * (wall * 0.7 + ledges * 0.3) + fbm(n1, x * 0.07, z * 0.07, 4) * 1.6 * wall + fbm(n2, x * 0.5, z * 0.5, 2) * 0.35;
      y += 2.4 * Math.exp(-((x - RADAR.x) ** 2 + (z - RADAR.z) ** 2) / 30);
      pos.setY(k, y);
      const g = 0.32 + 0.22 * Math.min(1, y / RIM) + fbm(n2, x * 1.3, z * 1.3, 2) * 0.05;
      colors.set([g * 1.12, g * 0.98, g * 0.84], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const sky = new THREE.Color(0x323943);
    this.fpv.background = sky;
    this.fpv.fog = new THREE.Fog(sky, 18, 75);
    this.fpv.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
    this.fpv.add(new THREE.HemisphereLight(0xc4ccd6, 0x3b342c, 1.1));
    const sun = new THREE.DirectionalLight(0xffe2c0, 2.6);
    sun.position.set(-30, 26, 18);
    this.fpv.add(sun);

    /* aircraft: simple fixed-wing, facing +x */
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.5, metalness: 0.2 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.3, 12), skin);
    fus.rotation.z = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 12), skin);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 0.77;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 2.3), skin);
    wing.position.x = 0.08;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.7), skin);
    tail.position.x = -0.56;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.02), skin);
    fin.position.set(-0.58, 0.15, 0);
    this.plane.add(fus, nose, wing, tail, fin);
    this.fpv.add(this.plane);

    /* radar coverage, in both views */
    const domeGeo = new THREE.SphereGeometry(RADAR_R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const [scene, op] of [[this.fpv, 0.1], [this.map, 0.16]] as const) {
      const d = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ color: 0xff3a24, wireframe: true, transparent: true, opacity: 0, depthWrite: false }));
      d.position.set(RADAR.x, RIM + 1.5, RADAR.z);
      d.userData.op = op;
      scene.add(d);
      this.domes.push(d);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x8a2a1c }));
      mast.position.set(RADAR.x, RIM + 2.1, RADAR.z);
      scene.add(mast);
    }
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(RADAR_R, 0, 0)]);
    this.sweep = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0 }));
    this.sweep.position.set(RADAR.x, RIM + 1.6, RADAR.z);
    this.map.add(this.sweep);

    /* map */
    this.mapMat = new THREE.ShaderMaterial({
      vertexShader: MAP_VERT,
      fragmentShader: MAP_FRAG,
      uniforms: { uDetect: { value: 0 }, uRadar: { value: new THREE.Vector2(RADAR.x, RADAR.z) }, uR: { value: RADAR_R }, uRim: { value: RIM } },
    });
    this.map.background = new THREE.Color(0x050506);
    this.map.add(new THREE.Mesh(geo, this.mapMat));
    const line = (pts: THREE.Vector3[], mat: THREE.Material) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      l.computeLineDistances();
      l.frustumCulled = false;
      l.renderOrder = 3;
      return l;
    };
    this.plannedLine = line(
      this.aPts.map(([x, z]) => new THREE.Vector3(x, ALT + 0.3, z)),
      new THREE.LineDashedMaterial({ color: 0xebe7de, dashSize: 1.2, gapSize: 0.7, transparent: true, depthTest: false }),
    );
    this.altLine = line(
      this.bPts.map(([x, z]) => new THREE.Vector3(x, ALT + 0.3, z)),
      new THREE.LineBasicMaterial({ color: 0xa8e6ff, transparent: true, opacity: 0, depthTest: false }),
    );
    this.trail = line(this.flight.pts.map((p) => p.clone().setY(ALT + 0.3)), new THREE.LineBasicMaterial({ color: 0xebe7de, transparent: true, opacity: 0.7, depthTest: false }));
    this.map.add(this.plannedLine, this.altLine, this.trail);
    const cone = new THREE.ConeGeometry(0.9, 2.4, 3);
    cone.rotateZ(-Math.PI / 2);
    this.marker.add(new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0x060708, depthTest: false })));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cone), new THREE.LineBasicMaterial({ color: 0xebe7de, depthTest: false }));
    this.marker.add(edges);
    this.marker.renderOrder = 4;
    this.map.add(this.marker);
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.vertical = this.w / this.h < 1;
    const fa = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.fpvCam.aspect = fa;
    this.mapCam.aspect = fa;
    this.mapCam.fov = this.vertical ? 40 : 30;
    this.fpvCam.updateProjectionMatrix();
    this.mapCam.updateProjectionMatrix();
  }

  /** Screen positions (CSS px) for the radar and the two route labels. */
  anchors() {
    const proj = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(this.mapCam);
      const [vx, vy, vw, vh] = this.vertical ? [0, this.h / 2, this.w, this.h / 2] : [this.w / 2, 0, this.w / 2, this.h];
      const sx = vx + ((v.x + 1) / 2) * vw;
      const sy = vy + ((1 - v.y) / 2) * vh;
      return [Math.min(Math.max(sx, vx + 12), vx + vw - 280), Math.min(Math.max(sy, vy + 160), vy + vh - 150)] as const;
    };
    const a = this.aPts[Math.floor(this.aPts.length * 0.35)];
    const b = this.bPts[Math.floor(this.bPts.length * 0.55)];
    return { radar: proj(RADAR.x, RIM + 3, RADAR.z), planned: proj(a[0], ALT, a[1]), detour: proj(b[0], ALT, b[1]) };
  }

  frame(dt: number, s: number, view: AirView = {}) {
    const { detect = 0, decided = 0 } = view;
    this.time += dt;
    const F = this.flight;
    const d = Math.min(1, Math.max(0, s)) * F.length;
    const p = F.at(d);
    const hd = F.heading(d);
    let turn = F.heading(d + 2.5) - F.heading(d - 2.5);
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.roll += (Math.max(-0.9, Math.min(0.9, turn * 2.2)) - this.roll) * Math.min(1, dt * 4);
    p.y += Math.sin(this.time * 1.3) * 0.05;
    this.plane.position.copy(p);
    this.plane.rotation.set(this.roll, -hd, 0, 'YXZ');

    const fx = Math.cos(hd);
    const fz = Math.sin(hd);
    this.fpvCam.position.set(p.x - fx * 4.2, p.y + 1.25, p.z - fz * 4.2);
    this.fpvCam.lookAt(p.x + fx * 3, p.y + 0.15, p.z + fz * 3);

    for (const dm of this.domes) (dm.material as THREE.MeshBasicMaterial).opacity = detect * dm.userData.op;
    (this.sweep.material as THREE.LineBasicMaterial).opacity = detect * 0.8;
    this.sweep.rotation.y = -this.time * 1.6;
    this.mapMat.uniforms.uDetect.value = detect;
    const pm = this.plannedLine.material as THREE.LineDashedMaterial;
    pm.color.setRGB(0.92 + 0.08 * detect, 0.9 - 0.65 * detect, 0.87 - 0.72 * detect);
    pm.opacity = 1 - decided * 0.5;
    (this.altLine.material as THREE.LineBasicMaterial).opacity = detect * (0.45 + 0.55 * decided);
    const idx = F.cum.findIndex((c) => c >= d);
    this.trail.geometry.setDrawRange(0, Math.max(1, idx));
    this.marker.position.set(p.x, ALT + 0.6, p.z);
    this.marker.rotation.y = -hd;

    const C = E / 2;
    const az = -1.6 + 0.25 * s + 0.04 * Math.sin(this.time * 0.2);
    const el = 1.05;
    const dist = this.vertical ? 170 : 150;
    this.mapCam.position.set(C + dist * Math.cos(el) * Math.cos(az), dist * Math.sin(el), C + 2 + dist * Math.cos(el) * Math.sin(az));
    this.mapCam.lookAt(C, 0, C + 2);

    const { w, h, renderer } = this;
    renderer.setScissorTest(true);
    const views: [THREE.Scene, THREE.Camera, number, number, number, number][] = this.vertical
      ? [[this.fpv, this.fpvCam, 0, Math.floor(h / 2), w, h - Math.floor(h / 2)], [this.map, this.mapCam, 0, 0, w, Math.floor(h / 2)]]
      : [[this.fpv, this.fpvCam, 0, 0, Math.floor(w / 2), h], [this.map, this.mapCam, Math.floor(w / 2), 0, w - Math.floor(w / 2), h]];
    for (const [scene, cam, x, y, vw, vh] of views) {
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(scene, cam);
    }
  }
}
