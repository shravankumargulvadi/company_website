/**
 * Industry & exploration: the machine's view beside the risk map it builds.
 * One canvas, split in two (side by side, or stacked on portrait screens).
 * The machines are deliberately generic: partner platforms, same Fieldcore OS.
 */
import * as THREE from 'three';
import {
  FIELD_DEMOS, distTo, fieldGrid, fieldMoment, fieldRoutes,
  type FieldDemo, type FieldGrid, type FieldId, type FieldRoutes, type Prop, type V2,
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
  tracks: THREE.Line[];
  light?: THREE.SpotLight;
  hot?: { mat: THREE.MeshStandardMaterial; light: THREE.PointLight };
  beam?: { group: THREE.Group; mat: THREE.MeshBasicMaterial; head: THREE.Object3D };
  link?: { line: THREE.Line; from: THREE.Vector3 };
  load?: THREE.Object3D;
  eye: number;
  back: number;
  /** Camera offset to the machine's left (+) or right (−), so its side and the ground around it are in view. */
  side: number;
}

const line = (pts: V2[], y: (x: number, z: number) => number, mat: THREE.Material) => {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y(x, z), z)));
  const l = new THREE.Line(g, mat);
  if (mat instanceof THREE.LineDashedMaterial) l.computeLineDistances();
  return l;
};

/** The polyline shifted sideways by `off` (wheel tracks, walkway edges). */
const offset = (pts: V2[], off: number): V2[] => pts.map(([x, z], i) => {
  const [ax, az] = pts[Math.max(0, i - 1)];
  const [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return [x - ((bz - az) / l) * off, z + ((bx - ax) / l) * off];
});

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

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

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};

/** Irregular rocks: an icosahedron with its corners pushed in and out (shared corners move together). */
const ROCKS = Array.from({ length: 6 }, (_, v) => {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const h = Math.sin(Math.round(x * 50) * 12.9898 + Math.round(y * 50) * 78.233 + Math.round(z * 50) * 37.719 + v * 3.7) * 43758.5453;
    const k = 0.72 + 0.42 * (h - Math.floor(h));
    pos.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  geo.computeVertexNormals();
  return geo;
});

/** Generic partner platforms, built facing +x. */
function machineFor(id: FieldId) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const legs: THREE.Object3D[] = [];
  let head: THREE.Object3D | undefined;
  let load: THREE.Object3D | undefined;
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, group);
  const wheel = (x: number, z: number, r: number, width = 0.16) => {
    const w = mesh(new THREE.CylinderGeometry(r, r, width, 16), dark, x, r, z, group);
    w.rotation.x = Math.PI / 2;
  };
  if (id === 'inspect') {
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
    /* sensor mast: pan-tilt head with visual and thermal cameras, lidar on top, gas sniffer */
    box(0.05, 0.34, 0.05, dark, 0.22, 0.91, 0);
    head = new THREE.Group();
    head.position.set(0.24, 1.1, 0);
    group.add(head);
    mesh(new THREE.BoxGeometry(0.16, 0.11, 0.26), body, 0, 0, 0, head);
    const lens = new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.15, metalness: 0.8 });
    for (const z of [-0.065, 0.065]) {
      const l = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12), lens, 0.09, 0, z, head);
      l.rotation.z = Math.PI / 2;
    }
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 18), dark, 0, 0.09, 0, head);
    mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 18), glow, 0, 0.1, 0, head);
    box(0.012, 0.22, 0.012, body, -0.36, 0.84, 0.1);
    box(0.03, 0.03, 0.03, glow, -0.36, 0.96, 0.1);
  } else if (id === 'rover') {
    /* rocker-bogie science rover: deck, mast camera, high-gain dish, power unit at the back */
    box(1.05, 0.24, 0.72, body, 0, 0.78, 0);
    box(0.9, 0.03, 0.66, new THREE.MeshStandardMaterial({ color: 0x202838, roughness: 0.3, metalness: 0.6 }), -0.05, 0.915, 0);
    for (const z of [-0.5, 0.5]) {
      box(1.0, 0.05, 0.05, dark, 0, 0.5, z);
      box(0.05, 0.3, 0.05, dark, 0.15, 0.64, z);
      for (const x of [-0.48, 0, 0.48]) {
        wheel(x, z, 0.17, 0.14);
        box(0.04, 0.32, 0.04, dark, x, 0.34, z);
      }
    }
    box(0.06, 0.8, 0.06, body, 0.38, 1.3, 0.22);
    box(0.18, 0.16, 0.36, body, 0.4, 1.74, 0.22);
    box(0.02, 0.06, 0.24, new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.15, metalness: 0.8 }), 0.5, 1.75, 0.22);
    const dish = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20), body, -0.18, 1.12, -0.22, group);
    dish.rotation.z = 0.7;
    box(0.04, 0.2, 0.04, dark, -0.18, 1.0, -0.22);
    const rtg = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 12), dark, -0.62, 0.95, 0, group);
    rtg.rotation.z = -0.9;
  } else {
    /* ultra-class mining haul truck: dump body with a canopy over the cab, front deck with
       a diagonal ladder, big radiator, dual rear tyres, and the partner's autonomy kit */
    const yellow = new THREE.MeshStandardMaterial({ color: 0xdca023, roughness: 0.55, metalness: 0.25 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.15, metalness: 0.8 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
    const hub = new THREE.MeshStandardMaterial({ color: 0x9a8a50, roughness: 0.5, metalness: 0.5 });
    const tyreAt = (x: number, z: number, out: number) => {
      const r = 0.64;
      const t = mesh(new THREE.CylinderGeometry(r, r, 0.44, 28), tyre, x, r, z, group);
      t.rotation.x = Math.PI / 2;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const lug = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.44), tyre, x + Math.cos(a) * r, r + Math.sin(a) * r, z, group);
        lug.rotation.z = a + Math.PI / 2;
      }
      const h = mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 18), hub, x, r, z + out * 0.23, group);
      h.rotation.x = Math.PI / 2;
      const cap = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), steel, x, r, z + out * 0.27, group);
      cap.rotation.x = Math.PI / 2;
    };
    for (const z of [-0.82, 0.82]) tyreAt(1.15, z, Math.sign(z));
    for (const z of [-0.6, -1.08, 0.6, 1.08]) tyreAt(-1.0, z, Math.sign(z));
    /* frame, engine bay, radiator and bumper */
    box(3.2, 0.34, 0.7, steel, 0, 0.9, 0);
    box(1.0, 0.85, 1.0, yellow, 1.25, 1.2, 0);
    box(0.08, 0.72, 0.9, steel, 1.79, 1.18, 0);
    for (let i = 0; i < 6; i++) box(0.02, 0.03, 0.86, new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.6 }), 1.84, 0.9 + i * 0.11, 0);
    box(0.16, 0.18, 1.9, steel, 1.86, 0.55, 0);
    /* front deck, ladder and handrails */
    box(0.75, 0.07, 2.2, yellow, 1.5, 1.66, 0);
    const ladder = box(0.06, 0.05, 1.5, steel, 1.95, 1.08, 0.1);
    ladder.rotation.x = -0.72;
    for (let i = 0; i < 6; i++) box(0.05, 0.03, 0.16, steel, 1.97, 0.66 + i * 0.17, 0.62 - i * 0.2);
    for (const z of [-1.08, -0.4, 0.4, 1.08]) box(0.03, 0.34, 0.03, yellow, 1.86, 1.86, z);
    box(0.03, 0.03, 2.2, yellow, 1.86, 2.02, 0);
    /* cab on the left of the deck, under the canopy */
    box(0.62, 0.56, 0.6, yellow, 1.38, 1.98, -0.68);
    box(0.02, 0.3, 0.5, glass, 1.7, 2.04, -0.68);
    box(0.5, 0.3, 0.02, glass, 1.38, 2.04, -0.99);
    box(0.5, 0.3, 0.02, glass, 1.38, 2.04, -0.37);
    box(0.12, 0.06, 0.12, new THREE.MeshBasicMaterial({ color: 0xff8a1a }), 1.42, 2.3, -0.68);
    /* headlights on the bumper and deck */
    for (const z of [-0.75, 0.75]) box(0.04, 0.1, 0.22, glow, 1.94, 0.58, z);
    for (const z of [-0.9, 0.9]) box(0.04, 0.08, 0.18, glow, 1.88, 1.74, z);
    /* dump body: floor, ribbed sides, front wall and canopy */
    const tray = new THREE.Group();
    group.add(tray);
    tray.position.set(-0.4, 1.5, 0);
    tray.rotation.z = 0.035;
    const tb = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, tray);
    tb(2.7, 0.1, 2.1, yellow, 0, 0, 0);
    for (const z of [-1.07, 1.07]) {
      tb(2.7, 0.78, 0.07, yellow, 0, 0.42, z);
      tb(2.72, 0.07, 0.14, yellow, 0, 0.83, z);
      for (let i = 0; i < 6; i++) tb(0.07, 0.72, 0.06, yellow, -1.2 + i * 0.48, 0.4, z + Math.sign(z) * 0.05);
    }
    tb(0.08, 1.0, 2.2, yellow, 1.33, 0.52, 0);
    tb(0.9, 0.06, 2.24, yellow, 1.78, 1.02, 0);
    for (const z of [-0.8, 0, 0.8]) tb(0.9, 0.1, 0.05, yellow, 1.78, 0.95, z);
    tb(0.08, 0.2, 2.1, yellow, -1.33, 0.12, 0);
    /* hoist cylinders */
    for (const z of [-0.42, 0.42]) {
      const cyl = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), steel, 0.25, 1.22, z, group);
      cyl.rotation.z = 0.5;
    }
    /* autonomy kit: lidar on the deck corners, GNSS antennas on the canopy */
    for (const z of [-1.02, 1.02]) mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12), steel, 1.82, 1.78, z, group);
    for (const z of [-0.7, 0.7]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xe8e4da }), 1.5, 2.58, z, group);
    /* the load: a heap of broken earth and rock */
    const loadGroup = new THREE.Group();
    tray.add(loadGroup);
    const earth = new THREE.MeshStandardMaterial({ color: 0x6b5442, roughness: 1, flatShading: true });
    const heap = mesh(ROCKS[0], earth, -0.05, 0.62, 0, loadGroup);
    heap.scale.set(1.25, 0.5, 0.95);
    const lr = rng(5);
    for (let i = 0; i < 9; i++) {
      const c = mesh(ROCKS[i % 6], earth, (lr() - 0.5) * 2.0, 0.85 + lr() * 0.2, (lr() - 0.5) * 1.4, loadGroup);
      c.scale.setScalar(0.14 + lr() * 0.16);
      c.rotation.set(lr() * 6, lr() * 6, 0);
    }
    load = loadGroup;
  }
  return { group, legs, head, load };
}

/** Site equipment for the inspection round: pumps, tanks, pipe racks and skids. */
function equipment(props: Prop[], fpv: THREE.Scene) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d636b, roughness: 0.5, metalness: 0.6 });
  const paint = new THREE.MeshStandardMaterial({ color: 0x3e6a7a, roughness: 0.6, metalness: 0.3 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.4 });
  const valve = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
  const dial = new THREE.MeshBasicMaterial({ color: 0xe8e4da });
  let hot: Built['hot'];
  for (const q of props) {
    if (q.kind === 'pump') {
      const motorMat = q.hot ? new THREE.MeshStandardMaterial({ color: 0x3e6a7a, roughness: 0.6, metalness: 0.3, emissive: 0xff3d1f, emissiveIntensity: 0 }) : paint;
      mesh(new THREE.BoxGeometry(q.w, 0.16, q.d), steel, q.x, 0.08, q.z, fpv);
      const motor = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 18), motorMat, q.x - 0.45, 0.62, q.z, fpv);
      motor.rotation.z = Math.PI / 2;
      const casing = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 18), steel, q.x + 0.55, 0.66, q.z, fpv);
      casing.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 10), steel, q.x + 0.55, 1.3, q.z, fpv);
      const wheel = mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 16), valve, q.x + 0.55, 1.5, q.z, fpv);
      wheel.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), steel, q.x - 1.1, 0.55, q.z + q.d / 2 + 0.2, fpv);
      const g = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16), dial, q.x - 1.1, 1.12, q.z + q.d / 2 + 0.2, fpv);
      g.rotation.x = Math.PI / 2;
      if (q.hot) {
        const light = new THREE.PointLight(0xff4a1f, 0, 7, 1.4);
        light.position.set(q.x - 0.45, 1.3, q.z);
        fpv.add(light);
        hot = { mat: motorMat as THREE.MeshStandardMaterial, light };
      }
    } else if (q.kind === 'tank') {
      mesh(new THREE.CylinderGeometry(q.w / 2, q.w / 2, q.h, 28), tankMat, q.x, q.h / 2, q.z, fpv);
      const dome = mesh(new THREE.SphereGeometry(q.w / 2, 28, 8, 0, Math.PI * 2, 0, Math.PI / 6), tankMat, q.x, q.h - (q.w / 2) * Math.cos(Math.PI / 6), q.z, fpv);
      dome.castShadow = false;
      mesh(new THREE.BoxGeometry(0.06, q.h, 0.5), steel, q.x + q.w / 2 + 0.05, q.h / 2, q.z, fpv);
    } else if (q.kind === 'rack') {
      for (let x = q.x - q.w / 2; x <= q.x + q.w / 2; x += 4) {
        mesh(new THREE.BoxGeometry(0.14, q.h, 0.14), steel, x, q.h / 2, q.z - 0.5, fpv);
        mesh(new THREE.BoxGeometry(0.14, q.h, 0.14), steel, x, q.h / 2, q.z + 0.5, fpv);
        mesh(new THREE.BoxGeometry(0.14, 0.14, 1.14), steel, x, q.h, q.z, fpv);
      }
      for (const [dz, r, m] of [[-0.3, 0.16, paint], [0, 0.2, steel], [0.3, 0.12, valve]] as [number, number, THREE.Material][]) {
        const pipe = mesh(new THREE.CylinderGeometry(r, r, q.w, 12), m, q.x, q.h + 0.2, q.z + dz, fpv);
        pipe.rotation.z = Math.PI / 2;
      }
    } else {
      mesh(new THREE.BoxGeometry(q.w, q.h, q.d), paint, q.x, q.h / 2, q.z, fpv);
      const wheel = mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 16), valve, q.x, q.h + 0.25, q.z, fpv);
      wheel.rotation.x = Math.PI / 2;
    }
  }
  return hot;
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
    this.setDemo('haul');
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
    const rand = rng(id.length * 7919);
    const gy = (x: number, z: number) => d.height(x, z);

    /* machine view */
    const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    if (id === 'inspect') {
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(d.extent + 40, d.extent + 40), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }));
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(d.extent / 2, 0, d.extent / 2);
      fpv.add(slab);
    } else {
      fpv.add(new THREE.Mesh(gridGeometry(g, 1, false), ground));
    }
    const { group: machine, legs, head, load } = machineFor(id);
    fpv.add(machine);
    let light: THREE.SpotLight | undefined;
    let hot: Built['hot'];
    let beam: Built['beam'];
    let link: Built['link'];
    let eye = 2.4;
    let back = 4.6;
    let side = 0;
    const rock = new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 1, flatShading: true });
    const rocks = (cx: number, cz: number, n: number, spread: number, size: number, keepOff = 0) => {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * spread;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        if (keepOff && (distTo(r.track.pts, x, z) < keepOff || distTo(r.planned, x, z) < keepOff)) continue;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size * (0.4 + rand()), 0), rock);
        m.position.set(x, gy(x, z) + size * 0.2, z);
        m.rotation.set(rand() * 6, rand() * 6, 0);
        m.scale.y = 0.6 + rand() * 0.4;
        fpv.add(m);
      }
    };
    if (id === 'haul') {
      fpv.background = new THREE.Color(0x3a3029);
      fpv.fog = new THREE.FogExp2(0x3a3029, 0.016);
      fpv.add(new THREE.HemisphereLight(0xe3cfb4, 0x2a2018, 0.95));
      const sun = new THREE.DirectionalLight(0xffe6c4, 2.3);
      sun.position.set(40, 45, 30);
      fpv.add(sun);
      const stone = [0x6a5a4a, 0x7a6656, 0x564a40].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
      const keep = (x: number, z: number) => distTo(r.track.pts, x, z) > 2.2 && distTo(r.planned, x, z) > 2.2;
      const place = (x: number, z: number, size: number) => {
        const m = new THREE.Mesh(ROCKS[Math.floor(rand() * 6)], stone[Math.floor(rand() * 3)]);
        m.position.set(x, gy(x, z) + size * 0.3, z);
        m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
        m.scale.set(size * (0.8 + rand() * 0.5), size * (0.6 + rand() * 0.4), size * (0.8 + rand() * 0.5));
        fpv.add(m);
      };
      /* the rockfall: a fan from the foot of the wall, the biggest blocks rolled furthest */
      const [hx, hz] = d.hazardAt;
      for (let i = 0; i < 46; i++) {
        const t = Math.pow(rand(), 0.8);
        const x = hx - 6 + t * 8.5;
        const z = hz + (rand() - 0.5) * 2 * (1.4 + t * 3);
        place(x, z, 0.16 + Math.pow(rand(), 2.2) * (0.35 + t * 0.6));
      }
      /* scree at the foot of every face and loose rock across the benches */
      for (let i = 0; i < 260; i++) {
        const toe = [22.4, 16.9, 11.4, 5.9, 40.8, 47.3][Math.floor(rand() * 6)];
        const x = rand() < 0.75 ? toe + (rand() - 0.3) * 1.6 : rand() * 60;
        const z = rand() * 60;
        if (keep(x, z)) place(x, z, 0.1 + Math.pow(rand(), 3) * 0.6);
      }
      /* the dump ahead */
      const dumpMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1, flatShading: true });
      /* tipped earth: a low, lumpy mound rather than a single boulder */
      const mound = new THREE.ConeGeometry(5.5, 2.6, 18, 4);
      const mp = mound.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < mp.count; i++) {
        const [x, y, z] = [mp.getX(i), mp.getY(i), mp.getZ(i)];
        const k = 1 + 0.16 * Math.sin(x * 1.7 + z * 2.3) + 0.1 * Math.sin(z * 3.1 - x * 0.9);
        mp.setXYZ(i, x * k, y * (0.75 + 0.25 * k), z * k);
      }
      mound.computeVertexNormals();
      const dump = mesh(mound, dumpMat, 21.5, gy(21.5, 2) + 0.9, 2, fpv);
      dump.scale.set(1, 1, 0.85);
      eye = 6;
      back = 9;
      side = -9;
    } else if (id === 'inspect') {
      fpv.background = new THREE.Color(0x07090d);
      fpv.fog = new THREE.FogExp2(0x07090d, 0.04);
      fpv.add(new THREE.HemisphereLight(0x6a7c98, 0x14161c, 1.1));
      const key = new THREE.PointLight(0xc8d8ff, 5, 7, 1.2);
      key.position.set(-1.4, 2.4, 1.4);
      machine.add(key);
      eye = 2.1;
      back = 3.6;
      const bulb = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
      for (const [x, z] of [[13, 50], [18, 38], [28, 34], [37, 31.5], [46, 29.5]] as V2[]) {
        mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), new THREE.MeshStandardMaterial({ color: 0x3a3d42 }), x, 2, z + 1.6, fpv);
        mesh(new THREE.SphereGeometry(0.16, 10, 8), bulb, x, 4, z + 1.6, fpv);
        const pl = new THREE.PointLight(0xffc98a, 14, 14, 1.6);
        pl.position.set(x, 3.8, z + 1.6);
        fpv.add(pl);
      }
      hot = equipment(d.props ?? [], fpv);
      const edge = new THREE.LineBasicMaterial({ color: 0xb8932a });
      const usual = [...r.main, ...r.planned.slice(1)];
      for (const o of [-1.3, 1.3]) fpv.add(line(offset(usual, o), () => 0.02, edge));
      if (head) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff6a3c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const geo = new THREE.ConeGeometry(0.9, 1, 24, 1, true);
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, 0, 0.5);
        const group = new THREE.Group();
        group.add(new THREE.Mesh(geo, mat));
        fpv.add(group);
        beam = { group, mat, head };
      }
    } else {
      fpv.background = new THREE.Color(0x24150d);
      fpv.fog = new THREE.FogExp2(0x24150d, 0.02);
      fpv.add(new THREE.HemisphereLight(0xd8a27a, 0x2a1a12, 0.7));
      const sun = new THREE.DirectionalLight(0xfff0e0, 2.2);
      sun.position.set(-30, 40, 10);
      fpv.add(sun);
      rock.color.set(0x6e4a36);
      rocks(d.extent / 2, d.extent / 2, 260, 34, 0.32, 1.6);
      /* the lander it drove off, and the rock it was sent to study */
      const [lx, lz] = [19.5, 50];
      const ly = gy(lx, lz);
      const metal = new THREE.MeshStandardMaterial({ color: 0xa8a29a, roughness: 0.5, metalness: 0.5 });
      const cell = new THREE.MeshStandardMaterial({ color: 0x1b2440, roughness: 0.3, metalness: 0.7 });
      mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.8, 6), metal, lx, ly + 1.3, lz, fpv);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const leg = mesh(new THREE.BoxGeometry(0.08, 1.3, 0.08), metal, lx + Math.cos(a) * 1.4, ly + 0.6, lz + Math.sin(a) * 1.4, fpv);
        leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      }
      for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(2.6, 0.04, 1.3), cell, lx + s * 2.6, ly + 1.4, lz, fpv);
      const ramp = mesh(new THREE.BoxGeometry(0.9, 0.04, 2.2), metal, lx + 1.6, ly + 0.55, lz - 1.6, fpv);
      ramp.rotation.set(0.4, 0.6, 0);
      const [ox, oz] = [38, 1.8];
      const strata = [0x8a5a3c, 0xb07a50, 0x7a4a30, 0xa06a44, 0x8a5a3c];
      strata.forEach((c, i) => {
        const m = mesh(new THREE.CylinderGeometry(1.5 - i * 0.24, 1.65 - i * 0.24, 0.42, 7), new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }), ox, gy(ox, oz) + 0.21 + i * 0.4, oz, fpv);
        m.rotation.y = i * 0.5;
      });
      const from = new THREE.Vector3(40, 10, -48);
      const earth = new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 14), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, fog: false }));
      earth.position.copy(from);
      fpv.add(earth);
      const lg = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
      const ll = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0x9fc4ff, dashSize: 0.8, gapSize: 0.8, transparent: true, opacity: 0.55, fog: false }));
      fpv.add(ll);
      link = { line: ll, from };
      eye = 3;
      back = 5.6;
    }
    const detourFpv = line(r.detour, (x, z) => (id === 'inspect' ? 0 : gy(x, z)) + 0.06,
      new THREE.LineBasicMaterial({ color: 0x7fe0c0, transparent: true, opacity: 0 }));
    fpv.add(detourFpv);
    const tracks = id === 'rover' ? [-0.5, 0.5].map((o) => {
      const t = line(offset(r.track.pts, o), (x, z) => gy(x, z) + 0.04, new THREE.LineBasicMaterial({ color: 0x2a170e }));
      fpv.add(t);
      return t;
    }) : [];

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
    const [gx, gz] = r.track.pts[r.track.pts.length - 1];
    const goal = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0xebe7de, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    goal.rotation.x = -Math.PI / 2;
    goal.position.set(gx, my(gx, gz) + 0.05, gz);
    map.add(usualMap, detourMap, trail, ring, markerWrap, goal);

    return { d, r, fpv, map, mapMat, machine, legs, ring, marker: markerWrap, trail, usualMap, detourMap, detourFpv, tracks, light, hot, beam, link, load, eye, back, side };
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
    const y = d.props ? 0 : d.height(x, z);
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
    const [rx, rz] = [-fz, fx];
    const ax = x + fx * 5 + rx * B.side * 0.5 + (hx - x - fx * 5) * look;
    const az = z + fz * 5 + rz * B.side * 0.5 + (hz - z - fz * 5) * look;
    this.fpvCam.position.set(x - fx * B.back - rx * B.side, y + B.eye, z - fz * B.back - rz * B.side);
    this.fpvCam.lookAt(ax, d.height(ax, az) * 0.3 + y * 0.7 + 0.4, az);
    if (B.light) {
      B.light.position.set(x + fx * 0.6, y + 0.8, z + fz * 0.6);
      B.light.target.position.set(x + fx * 8, y + 0.2, z + fz * 8);
    }
    const pulse = this.reduced ? 1 : 0.75 + 0.25 * Math.sin(this.time * 3);
    if (B.hot) {
      B.hot.mat.emissiveIntensity = m.detect * 0.9 * pulse;
      B.hot.light.intensity = m.detect * 10 * pulse;
    }
    if (B.beam) {
      const from = B.beam.head.getWorldPosition(new THREE.Vector3());
      const to = new THREE.Vector3(hx, 0.7, hz);
      B.beam.group.position.copy(from);
      B.beam.group.lookAt(to);
      B.beam.group.scale.set(1, 1, from.distanceTo(to));
      B.beam.mat.opacity = m.detect * (1 - m.done) * 0.16 * pulse;
    }
    if (B.link) {
      /* the link to Earth, minutes behind */
      const to = new THREE.Vector3(x, y + 1.7, z);
      const pos = B.link.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      B.link.line.computeLineDistances();
    }
    if (B.load) B.load.visible = m.done < 0.5;
    const drawn = Math.max(1, Math.round((dist / r.track.length) * (r.track.pts.length - 1)) + 1);
    for (const t of B.tracks) t.geometry.setDrawRange(0, drawn);
    (B.detourFpv.material as THREE.LineBasicMaterial).opacity = m.decided * (1 - m.done) * 0.9;

    const U = B.mapMat.uniforms;
    U.uS.value = m.s;
    U.uDetect.value = m.detect;
    U.uTime.value = this.reduced ? 0 : this.time;
    (B.usualMap.material as THREE.LineDashedMaterial).opacity = 0.7 * (1 - (d.blocked ? 0.6 : 0.3) * m.decided);
    (B.usualMap.material as THREE.LineDashedMaterial).color.set(d.blocked && m.decided > 0.5 ? 0xff5a3c : 0xebe7de);
    (B.detourMap.material as THREE.LineBasicMaterial).opacity = m.detect * (0.35 + 0.65 * m.decided);
    B.trail.geometry.setDrawRange(0, drawn);
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
