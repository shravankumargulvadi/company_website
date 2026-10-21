/**
 * Industry & exploration: the machine's view beside the risk map it builds.
 * One canvas, split in two (side by side, or stacked on portrait screens).
 * The machines are deliberately generic: partner platforms, same Fieldcore OS.
 */
import * as THREE from 'three';
import {
  FIELD_DEMOS, fieldGrid, fieldMoment, fieldRoutes,
  type FieldDemo, type FieldGrid, type FieldId, type FieldRoutes, type V2,
} from '../../lib/fieldDemo';

const RAMP: [number, number, number][] = [[58, 72, 82], [168, 98, 36], [255, 124, 52]];
const MAP_Y = 0.5;

const mapVS = /* glsl */ `
  attribute float aRisk; attribute float aHaz; attribute float aUnc; attribute float aSeen;
  varying float vRisk; varying float vHaz; varying float vUnc; varying float vSeen; varying float vShade; varying vec3 vPos;
  void main() {
    vRisk = aRisk; vHaz = aHaz; vUnc = aUnc; vSeen = aSeen; vPos = position;
    vShade = 0.55 + 0.45 * max(0.0, dot(normalize(normal), normalize(vec3(-0.4, 1.0, -0.3))));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const mapFS = /* glsl */ `
  uniform float uS; uniform float uDetect; uniform float uTime; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
  varying float vRisk; varying float vHaz; varying float vUnc; varying float vSeen; varying float vShade; varying vec3 vPos;
  vec3 ramp(float t) { return t < 0.5 ? mix(uC0, uC1, t / 0.5) : mix(uC1, uC2, (t - 0.5) / 0.5); }
  void main() {
    float known = 1.0 - smoothstep(uS, uS + 0.012, vSeen);
    float hatch = step(0.82, fract((vPos.x + vPos.z) * 1.1));
    vec3 unknownCol = mix(vec3(0.043, 0.047, 0.055), vec3(0.66, 0.38, 0.14) * 0.42, hatch);
    vec3 col = ramp(clamp(vRisk, 0.0, 1.0)) * vShade;
    col = mix(col, vec3(1.0, 0.24, 0.12), clamp(vHaz * uDetect * 1.4, 0.0, 1.0) * 0.92);
    col = mix(col, vec3(0.62, 0.45, 1.0) * (0.8 + 0.2 * sin(uTime * 2.0)), clamp(vUnc * 0.75, 0.0, 0.6));
    gl_FragColor = vec4(mix(unknownCol, col, known), 1.0);
  }`;

interface Built {
  d: FieldDemo;
  r: FieldRoutes;
  fpv: THREE.Scene;
  map: THREE.Scene;
  mapMat: THREE.ShaderMaterial;
  machine: THREE.Group;
  legs: THREE.Object3D[];
  ring: THREE.Mesh;
  marker: THREE.Mesh;
  trail: THREE.Line;
  usualMap: THREE.Line;
  detourMap: THREE.Line;
  detourFpv: THREE.Line;
  dust?: THREE.Points;
  light?: THREE.SpotLight;
  eye: number;
}

const line = (pts: V2[], y: (x: number, z: number) => number, mat: THREE.Material) => {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y(x, z), z)));
  const l = new THREE.Line(g, mat);
  if (mat instanceof THREE.LineDashedMaterial) l.computeLineDistances();
  return l;
};

function gridGeometry(g: FieldGrid, yScale: number, withRisk: boolean) {
  const { R } = g;
  const n = (R + 1) * (R + 1);
  const pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) pos.set([g.xs[k], g.ys[k] * yScale, g.zs[k]], k * 3);
  const idx: number[] = [];
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const a = j * (R + 1) + i;
      idx.push(a, a + R + 1, a + 1, a + 1, a + R + 1, a + R + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (withRisk) {
    geo.setAttribute('aRisk', new THREE.BufferAttribute(g.risk, 1));
    geo.setAttribute('aHaz', new THREE.BufferAttribute(g.haz, 1));
    geo.setAttribute('aUnc', new THREE.BufferAttribute(g.unc, 1));
    geo.setAttribute('aSeen', new THREE.BufferAttribute(g.seen, 1));
  } else {
    geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Generic partner platforms, built facing +x. */
function machineFor(id: FieldId) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const legs: THREE.Object3D[] = [];
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    group.add(b);
    return b;
  };
  const wheel = (x: number, z: number, r: number) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.16, 14), dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, r, z);
    group.add(w);
  };
  if (id === 'patrol') {
    box(0.95, 0.24, 0.36, body, 0, 0.62, 0);
    box(0.2, 0.14, 0.24, dark, 0.52, 0.66, 0);
    box(0.04, 0.04, 0.2, glow, 0.63, 0.68, 0);
    for (const [x, z] of [[0.36, 0.2], [0.36, -0.2], [-0.36, 0.2], [-0.36, -0.2]]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.56, z);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), dark);
      upper.position.y = -0.15;
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), body);
      lower.position.set(0.05, -0.42, 0);
      hip.add(upper, lower);
      group.add(hip);
      legs.push(hip);
    }
  } else if (id === 'rover') {
    box(1.1, 0.22, 0.78, body, 0, 0.62, 0);
    box(0.06, 0.7, 0.06, body, 0.32, 1.05, 0.2);
    box(0.16, 0.14, 0.32, dark, 0.36, 1.45, 0.2);
    box(0.5, 0.02, 0.4, new THREE.MeshStandardMaterial({ color: 0x202838, roughness: 0.3, metalness: 0.6 }), -0.25, 0.75, 0);
    for (const x of [-0.42, 0, 0.42]) for (const z of [-0.44, 0.44]) wheel(x, z, 0.18);
  } else {
    box(1.25, 0.46, 0.78, body, 0, 0.5, 0);
    box(0.06, 0.08, 0.5, glow, 0.64, 0.62, 0);
    box(0.2, 0.2, 0.2, dark, 0.3, 0.83, 0);
    for (const x of [-0.42, 0.42]) for (const z of [-0.44, 0.44]) wheel(x, z, 0.24);
  }
  return { group, legs };
}

export class FieldScene {
  private renderer: THREE.WebGLRenderer;
  private fpvCam = new THREE.PerspectiveCamera(62, 1, 0.05, 90);
  private mapCam = new THREE.PerspectiveCamera(30, 1, 1, 400);
  private built = new Map<FieldId, Built>();
  private cur!: Built;
  private w = 1;
  private h = 1;
  private vertical = false;
  private time = 0;
  private gait = 0;
  private lastS = 0;
  private heading = 0;
  private reduced: boolean;
  private R: number;

  constructor(private canvas: HTMLCanvasElement, opts: { lowPower?: boolean; reducedMotion?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.5));
    this.renderer.setClearColor(0x050506, 1);
    this.reduced = !!opts.reducedMotion;
    this.R = opts.lowPower ? 96 : 140;
    this.setDemo('mine');
  }

  setDemo(id: FieldId) {
    let b = this.built.get(id);
    if (!b) {
      b = this.build(id);
      this.built.set(id, b);
    }
    this.cur = b;
    this.lastS = 0;
    this.heading = b.r.track.heading(0);
  }

  private build(id: FieldId): Built {
    const d = FIELD_DEMOS[id]();
    const r = fieldRoutes(d);
    const g = fieldGrid(d, r, this.R);
    const fpv = new THREE.Scene();
    const map = new THREE.Scene();

    /* machine view */
    const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: id !== 'rover' });
    fpv.add(new THREE.Mesh(gridGeometry(g, 1, false), ground));
    const { group: machine, legs } = machineFor(id);
    fpv.add(machine);
    let light: THREE.SpotLight | undefined;
    let dust: THREE.Points | undefined;
    let eye = 2;
    if (id === 'mine') {
      fpv.background = new THREE.Color(0x050506);
      fpv.fog = new THREE.FogExp2(0x050506, 0.075);
      fpv.add(new THREE.AmbientLight(0xffffff, 0.05));
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(d.extent, d.extent), new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: 1, side: THREE.DoubleSide }));
      roof.rotation.x = Math.PI / 2;
      roof.position.set(d.extent / 2, 4.1, d.extent / 2);
      fpv.add(roof);
      light = new THREE.SpotLight(0xfff1dc, 60, 26, 0.62, 0.45, 1.6);
      fpv.add(light, light.target);
      const rock = new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 1, flatShading: true });
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + ((i * 37) % 10) / 22, 0), rock);
        const a = i * 2.4;
        const rr = 0.4 + ((i * 53) % 10) / 7;
        const x = d.hazardAt[0] + Math.cos(a) * rr;
        const z = d.hazardAt[1] + Math.sin(a) * rr * 0.7;
        m.position.set(x, d.height(x, z) + 0.15, z);
        m.rotation.set(a, a * 1.3, 0);
        fpv.add(m);
      }
      const N = 900;
      const pts = new Float32Array(N * 3);
      const dz = d.hazards.find((h) => h.always)!;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * dz.r * 1.3;
        pts.set([dz.x + Math.cos(a) * rr * 0.5, 0.2 + Math.random() * 3.6, dz.z + Math.sin(a) * rr], i * 3);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xc8bba6, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false }));
      fpv.add(dust);
    } else if (id === 'patrol') {
      fpv.background = new THREE.Color(0x07090d);
      fpv.fog = new THREE.FogExp2(0x07090d, 0.045);
      fpv.add(new THREE.HemisphereLight(0x5a6c88, 0x0b0c10, 0.55));
      const bulb = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
      for (const [x, z] of [[14, 50], [24, 39], [35, 32], [31, 22], [39, 10]] as V2[]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), new THREE.MeshStandardMaterial({ color: 0x3a3d42 }));
        post.position.set(x + 2.2, 2, z);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bulb);
        lamp.position.set(x + 2.2, 4, z);
        const pl = new THREE.PointLight(0xffc98a, 14, 14, 1.6);
        pl.position.set(x + 2.2, 3.8, z);
        fpv.add(post, lamp, pl);
      }
      const [hx, hz] = d.hazardAt;
      const spill = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0x6a2a06, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0.7 }));
      spill.rotation.x = -Math.PI / 2;
      spill.scale.set(1, 0.7, 1);
      spill.position.set(hx, 0.06, hz);
      fpv.add(spill);
      const cone = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x401400 });
      for (const [ox, oz] of [[-2.6, 1.6], [-1.2, 2.8], [2.4, -1.4]]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), cone);
        c.position.set(hx + ox, 0.25, hz + oz);
        fpv.add(c);
      }
      eye = 2.4;
    } else {
      fpv.background = new THREE.Color(0x0b0807);
      fpv.fog = new THREE.FogExp2(0x1a110c, 0.016);
      fpv.add(new THREE.HemisphereLight(0xd8a27a, 0x2a1a12, 0.65));
      const sun = new THREE.DirectionalLight(0xfff0e0, 2.2);
      sun.position.set(-30, 40, 10);
      fpv.add(sun);
      eye = 2.4;
    }
    const detourFpv = line(r.detour, (x, z) => d.height(x, z) + 0.06,
      new THREE.LineBasicMaterial({ color: 0x7fe0c0, transparent: true, opacity: 0 }));
    fpv.add(detourFpv);

    /* risk map */
    const c = (i: number) => new THREE.Vector3(...RAMP[i].map((v) => v / 255));
    const mapMat = new THREE.ShaderMaterial({
      vertexShader: mapVS, fragmentShader: mapFS,
      uniforms: { uS: { value: 0 }, uDetect: { value: 0 }, uTime: { value: 0 }, uC0: { value: c(0) }, uC1: { value: c(1) }, uC2: { value: c(2) } },
    });
    map.add(new THREE.Mesh(gridGeometry(g, MAP_Y, true), mapMat));
    const my = (x: number, z: number) => d.height(x, z) * MAP_Y + 0.25;
    const usualMap = line([...r.main, ...r.planned.slice(1)], my, new THREE.LineDashedMaterial({ color: 0xebe7de, dashSize: 0.7, gapSize: 0.5, transparent: true, opacity: 0.7 }));
    const detourMap = line(r.detour, my, new THREE.LineBasicMaterial({ color: 0x7fe0c0, transparent: true, opacity: 0 }));
    const trail = line(r.track.pts, my, new THREE.LineBasicMaterial({ color: 0xffb347 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(d.sensor * 0.96, d.sensor, 64), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 3), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    marker.rotation.z = -Math.PI / 2;
    const markerWrap = new THREE.Mesh();
    markerWrap.add(marker);
    map.add(usualMap, detourMap, trail, ring, markerWrap);

    return { d, r, fpv, map, mapMat, machine, legs, ring, marker: markerWrap, trail, usualMap, detourMap, detourFpv, dust, light, eye };
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.vertical = this.w / this.h < 1;
    const fa = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.fpvCam.aspect = fa;
    this.mapCam.aspect = fa;
    this.mapCam.fov = this.vertical ? 40 : 32;
    this.fpvCam.updateProjectionMatrix();
    this.mapCam.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of the hazard on the map. */
  anchor(): [number, number] {
    const { d } = this.cur;
    const [x, z] = d.hazardAt;
    const v = new THREE.Vector3(x, d.height(x, z) * MAP_Y + 0.5, z).project(this.mapCam);
    const [vx, vy, vw, vh] = this.vertical ? [0, this.h / 2, this.w, this.h / 2] : [this.w / 2, 0, this.w / 2, this.h];
    return [vx + ((v.x + 1) / 2) * vw, vy + ((1 - v.y) / 2) * vh];
  }

  frame(dt: number, p: number) {
    const B = this.cur;
    const { d, r } = B;
    this.time += dt;
    const m = fieldMoment(p, r.fork);
    const dist = m.s * r.track.length;
    const [x, z] = r.track.at(dist);
    const target = r.track.heading(Math.max(0.6, dist));
    const dh = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
    this.heading += this.reduced ? dh : dh * Math.min(1, dt * 4);
    const y = d.height(x, z);
    B.machine.position.set(x, y, z);
    B.machine.rotation.y = -this.heading;
    const moved = Math.abs(dist - this.lastS);
    this.lastS = dist;
    if (!this.reduced) this.gait += Math.min(moved, 0.5) * 5;
    B.legs.forEach((leg, i) => { leg.rotation.z = Math.sin(this.gait + (i % 3 === 0 ? 0 : Math.PI)) * 0.45 * Math.min(1, moved * 30); });

    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    const [hx, hz] = d.hazardAt;
    const look = 0.55 * m.detect * (1 - m.decided);
    const ax = x + fx * 5 + (hx - x - fx * 5) * look;
    const az = z + fz * 5 + (hz - z - fz * 5) * look;
    this.fpvCam.position.set(x - fx * 4.6, y + B.eye, z - fz * 4.6);
    this.fpvCam.lookAt(ax, d.height(ax, az) * 0.3 + y * 0.7 + 0.4, az);
    if (B.light) {
      B.light.position.set(x + fx * 0.6, y + 0.8, z + fz * 0.6);
      B.light.target.position.set(x + fx * 8, y + 0.2, z + fz * 8);
    }
    if (B.dust && !this.reduced) B.dust.rotation.y = Math.sin(this.time * 0.1) * 0.01;
    (B.detourFpv.material as THREE.LineBasicMaterial).opacity = m.decided * (1 - m.done) * 0.9;

    const U = B.mapMat.uniforms;
    U.uS.value = m.s;
    U.uDetect.value = m.detect;
    U.uTime.value = this.reduced ? 0 : this.time;
    (B.usualMap.material as THREE.LineDashedMaterial).opacity = 0.7 * (1 - 0.6 * m.decided);
    (B.usualMap.material as THREE.LineDashedMaterial).color.set(m.decided > 0.5 ? 0xff5a3c : 0xebe7de);
    (B.detourMap.material as THREE.LineBasicMaterial).opacity = m.detect * (0.35 + 0.65 * m.decided);
    B.trail.geometry.setDrawRange(0, Math.max(1, Math.round((dist / r.track.length) * (r.track.pts.length - 1)) + 1));
    const my = y * MAP_Y + 0.3;
    B.ring.position.set(x, my, z);
    B.marker.position.set(x, my + 0.8, z);
    B.marker.rotation.y = -this.heading;

    const C = d.extent / 2;
    const az0 = -1.75 + m.s * 0.5 + (this.reduced ? 0 : 0.04 * Math.sin(this.time * 0.2));
    const el = 1.08;
    const D = this.vertical ? 100 : 140;
    const tx = C + (x - C) * 0.08;
    const tz = C + (z - C) * 0.08;
    this.mapCam.position.set(tx + D * Math.cos(el) * Math.cos(az0), D * Math.sin(el), tz + D * Math.cos(el) * Math.sin(az0));
    this.mapCam.lookAt(tx, 0, tz);

    const { w, h, renderer } = this;
    renderer.setScissorTest(true);
    const views: [THREE.Scene, THREE.Camera, number, number, number, number][] = this.vertical
      ? [[B.fpv, this.fpvCam, 0, Math.floor(h / 2), w, h - Math.floor(h / 2)], [B.map, this.mapCam, 0, 0, w, Math.floor(h / 2)]]
      : [[B.fpv, this.fpvCam, 0, 0, Math.floor(w / 2), h], [B.map, this.mapCam, Math.floor(w / 2), 0, w - Math.floor(w / 2), h]];
    for (const [scene, cam, vx, vy, vw, vh] of views) {
      renderer.setViewport(vx, vy, vw, vh);
      renderer.setScissor(vx, vy, vw, vh);
      renderer.render(scene, cam);
    }
    return m;
  }
}
