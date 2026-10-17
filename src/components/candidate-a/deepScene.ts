/**
 * Candidate A — underground chapter. One WebGL context, two viewports:
 * a chase camera following the rover through the passage, and the 2.5D
 * elevation / risk map it builds from its range sensor. Both are driven by
 * path distance `s`.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../lib/noise';
import { poseAtS, type Passage, type PassagePose } from '../../lib/passage';

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
`;

const ROCK_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vW = position;
    vN = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* Procedural layered rock, lit only by the rover's lamp and a dim camera fill. */
const ROCK_FRAG = /* glsl */ `
  uniform vec3 uCam;
  uniform vec3 uLamp;
  uniform vec3 uLampDir;
  uniform float uTime;
  varying vec3 vW;
  varying vec3 vN;
  ${NOISE}
  void main() {
    vec3 p = vW;
    float dc0 = length(uCam - p);
    float detail = 1.0 - smoothstep(3.0, 9.0, dc0);
    float big = fbm(p * 0.55);
    float strata = sin(p.y * 6.0 + big * 6.0);
    float h = big * 0.7 + fbm(p * 1.8) * 0.3 * (0.4 + 0.6 * detail) + 0.06 * strata;
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 dpdx = dFdx(p);
    vec3 dpdy = dFdy(p);
    vec3 r1 = cross(dpdy, N);
    vec3 r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    N = normalize(abs(det) * N - grad * 0.45);

    float alb = 0.26 + 0.26 * big + 0.04 * strata + 0.05 * detail * (noise(p * 9.0) - 0.5);
    alb *= mix(0.8, 1.05, smoothstep(-0.2, 0.7, N.y));

    vec3 L = uLamp - p;
    float d = length(L);
    L /= d;
    float cone = smoothstep(0.3, 0.85, dot(-L, uLampDir));
    float lamp = max(dot(N, L), 0.0) * (0.3 + 0.7 * cone) * 1.5 / (1.0 + d * d * 0.3);
    vec3 C = uCam - p;
    float dc = length(C);
    float fill = max(dot(N, C / dc), 0.0) * 0.32 / (1.0 + dc * dc * 0.15);
    float c = alb * (lamp + fill + 0.02 + 0.02 * N.y);
    c = mix(c, 0.025, 1.0 - exp(-dc * 0.11));
    c += (fract(sin(dot(gl_FragCoord.xy + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.022;
    gl_FragColor = vec4(vec3(pow(max(c, 0.0), 1.0 / 2.2)), 1.0);
  }
`;

/*
 * Elevation-map surface. Unobserved cells sit on a flat grey plane; observed
 * cells rise to their measured height. Height noise scales with range at
 * observation, so far-off cells look spiky and settle as the rover closes in.
 * Colour is risk on a green → cyan → blue → magenta → red hue ramp.
 */
const MAP_VERT = /* glsl */ `
  attribute float aH;
  attribute float aRisk;
  attribute float aS1;
  attribute float aR1;
  attribute float aS2;
  attribute float aR2;
  attribute float aSeed;
  uniform float uS;
  uniform float uRange;
  uniform float uBase;
  uniform float uVS;
  uniform float uPlane;
  uniform float uFloor;
  varying float vRisk;
  varying float vKnown;
  varying vec3 vW;
  void main() {
    float known = step(aS1, uS);
    float grow = known * smoothstep(0.0, 1.2, uS - aS1);
    float r = uS >= aS2 ? aR2 : aR1;
    float unc = clamp(r / uRange, 0.0, 1.0);
    float nz = (aSeed - 0.5) * (0.08 + 1.2 * unc * unc) * (0.3 + aRisk);
    float hk = (min(aH - uBase, 2.4) + nz) * uVS;
    vec3 p = vec3(position.x, mix(uPlane, hk, grow), position.z);
    vRisk = clamp(aRisk + 0.15 * unc * (1.0 - aRisk) + nz * 1.3 + (aH - uFloor) * 0.45 * (1.0 - aRisk), -0.2, 1.0);
    vKnown = grow;
    vW = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const MAP_FRAG = /* glsl */ `
  varying float vRisk;
  varying float vKnown;
  varying vec3 vW;
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  void main() {
    vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
    if (N.y < 0.0) N = -N;
    float lit = 0.86 + 0.14 * max(dot(N, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
    vec3 col = hue(fract((120.0 + vRisk * 240.0) / 360.0));
    vec2 g = abs(fract(vW.xz) - 0.5);
    vec3 unk = mix(vec3(0.26, 0.27, 0.29), vec3(0.32, 0.33, 0.35), step(0.47, max(g.x, g.y)));
    gl_FragColor = vec4(mix(unk, col, step(0.02, vKnown)) * lit, 1.0);
  }
`;

function surface(P: Passage, field: Float32Array) {
  const g = new THREE.PlaneGeometry(P.extent, P.extent, P.res - 1, P.res - 1);
  g.rotateX(-Math.PI / 2);
  g.translate(P.extent / 2, 0, P.extent / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, field[k]);
  g.computeVertexNormals();
  return g;
}

function dynLine(count: number, color: number, opacity: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  l.frustumCulled = false;
  return l;
}

function roverModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.46), dark);
  body.position.y = 0.25;
  const wheel = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 18);
  wheel.rotateX(Math.PI / 2);
  for (const [x, z] of [[0.25, 0.27], [0.25, -0.27], [-0.25, 0.27], [-0.25, -0.27]]) {
    const w = new THREE.Mesh(wheel, dark);
    w.position.set(x, 0.13, z);
    g.add(w);
  }
  const lidar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.08, 18),
    new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.35, metalness: 0.6 }),
  );
  lidar.position.set(0.12, 0.4, 0);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  led.position.set(-0.36, 0.3, 0.18);
  g.add(body, lidar, led);
  return g;
}

const finite = (a: Float32Array) => a.map((v) => (Number.isFinite(v) ? v : 1e6));

export class DeepScene {
  private renderer: THREE.WebGLRenderer;
  private fpv = new THREE.Scene();
  private map = new THREE.Scene();
  private fpvCam = new THREE.PerspectiveCamera(56, 1, 0.05, 40);
  private mapCam = new THREE.PerspectiveCamera(36, 1, 0.5, 300);
  private rockMat: THREE.ShaderMaterial;
  private mapMat: THREE.ShaderMaterial;
  private rover = roverModel();
  private trail: THREE.Line;
  private aheadFpv: THREE.Line;
  private axes = new THREE.AxesHelper(1.4);
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private primed = false;
  private closed: boolean;
  private vertical = false;
  private mapDist = 60;
  private w = 1;
  private h = 1;
  private time = 0;
  private readonly VS = 1.3;
  private centre: [number, number];

  constructor(private canvas: HTMLCanvasElement, private P: Passage, opts: { lowPower?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.25));
    const a = P.path[0];
    const b = P.path[P.path.length - 1];
    this.closed = Math.hypot(a.x - b.x, a.z - b.z) < 1;
    const xs = P.path.map((p) => p.x);
    const zs = P.path.map((p) => p.z);
    this.centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];

    /* chase camera view */
    this.rockMat = new THREE.ShaderMaterial({
      vertexShader: ROCK_VERT,
      fragmentShader: ROCK_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uLamp: { value: new THREE.Vector3() },
        uLampDir: { value: new THREE.Vector3(1, 0, 0) },
        uTime: { value: 0 },
      },
    });
    this.fpv.add(new THREE.Mesh(surface(P, P.floor), this.rockMat));
    this.fpv.add(new THREE.Mesh(surface(P, P.ceil), this.rockMat));
    this.fpv.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.fpvCam.add(new THREE.PointLight(0xffffff, 6, 8, 2));
    this.fpv.add(this.fpvCam, this.rover);
    this.aheadFpv = dynLine(60, 0xffb347, 0.55);
    this.fpv.add(this.aheadFpv);

    /* elevation / risk map */
    const n = P.n;
    const N = n * n;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const rnd = mulberry32(7);
    for (let k = 0; k < N; k++) {
      pos[k * 3] = ((k % n) + 0.5) * P.cell;
      pos[k * 3 + 2] = (Math.floor(k / n) + 0.5) * P.cell;
      seed[k] = rnd();
    }
    const index: number[] = [];
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const q = j * n + i;
        index.push(q, q + n, q + 1, q + 1, q + n, q + n + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(index);
    const attrs: [string, Float32Array][] = [
      ['aH', P.height], ['aRisk', P.risk], ['aS1', finite(P.s1)], ['aR1', finite(P.r1)],
      ['aS2', finite(P.s2)], ['aR2', finite(P.r2)], ['aSeed', seed],
    ];
    for (const [name, arr] of attrs) geo.setAttribute(name, new THREE.BufferAttribute(arr, 1));
    const plane = Math.max(0.05, (P.path.reduce((m, p) => m + p.y, 0) / P.path.length - P.base) * this.VS);
    this.mapMat = new THREE.ShaderMaterial({
      vertexShader: MAP_VERT,
      fragmentShader: MAP_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uS: { value: 0 }, uRange: { value: P.range }, uBase: { value: P.base },
        uVS: { value: this.VS }, uPlane: { value: plane },
        uFloor: { value: P.path.reduce((m, p) => m + p.y, 0) / P.path.length },
      },
    });
    const surf = new THREE.Mesh(geo, this.mapMat);
    surf.frustumCulled = false;
    this.map.add(surf);

    const grid = new THREE.GridHelper(P.extent * 1.8, 54, 0x3a3d42, 0x303236);
    grid.position.set(P.extent / 2, plane - 0.02, P.extent / 2);
    this.map.add(grid);

    this.trail = dynLine(P.path.length, 0xffffff, 0.75);
    const tp = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    P.path.forEach((p, i) => tp.setXYZ(i, p.x, this.mapY(p.y) + 0.08, p.z));
    this.map.add(this.trail, this.axes);
  }

  private mapY(y: number) {
    return Math.max(0.04, (y - this.P.base) * this.VS);
  }

  private sample(f: Float32Array, x: number, z: number) {
    const R = this.P.res;
    const t = (R - 1) / this.P.extent;
    const fx = Math.min(R - 1.001, Math.max(0, x * t));
    const fz = Math.min(R - 1.001, Math.max(0, z * t));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * R + i;
    return (f[k] * (1 - u) + f[k + 1] * u) * (1 - v) + (f[k + R] * (1 - u) + f[k + R + 1] * u) * v;
  }

  private at(s: number): PassagePose {
    const L = this.P.length;
    if (s >= 0 && s <= L) return poseAtS(this.P, s);
    if (this.closed) return poseAtS(this.P, ((s % L) + L) % L);
    const e = poseAtS(this.P, s < 0 ? 0 : L);
    const d = s < 0 ? s : s - L;
    return { ...e, x: e.x + Math.cos(e.heading) * d, z: e.z + Math.sin(e.heading) * d, s };
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.vertical = this.w / this.h < 1;
    const aspect = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.fpvCam.aspect = aspect;
    this.mapCam.aspect = aspect;
    this.fpvCam.updateProjectionMatrix();
    this.mapCam.updateProjectionMatrix();
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.mapCam.fov / 2)) * Math.min(1, aspect));
    this.mapDist = (this.P.extent * 0.4) / Math.tan(half);
  }

  frame(dt: number, s: number) {
    const P = this.P;
    this.time += dt;
    s = Math.min(P.length - 0.01, Math.max(0, s));
    const pose = poseAtS(P, s);
    const fx = Math.cos(pose.heading);
    const fz = Math.sin(pose.heading);

    const pf = this.at(s + 0.3);
    const pb = this.at(s - 0.3);
    this.rover.position.set(pose.x, pose.y, pose.z);
    this.rover.rotation.order = 'YXZ';
    this.rover.rotation.y = -pose.heading;
    this.rover.rotation.z = Math.atan2(pf.y - pb.y, 0.6);

    const back = this.at(s - 4.6);
    const ahead = this.at(s + 3.2);
    const camY = Math.min(Math.max(back.y, pose.y) + 1.55, this.sample(P.ceil, back.x, back.z) - 0.25);
    const tPos = new THREE.Vector3(back.x, camY, back.z);
    const tLook = new THREE.Vector3(ahead.x, ahead.y + 0.3, ahead.z);
    const k = this.primed ? 1 - Math.exp(-dt * 6) : 1;
    this.camPos.lerp(tPos, k);
    this.camLook.lerp(tLook, k);
    this.primed = true;
    this.fpvCam.position.copy(this.camPos);
    this.fpvCam.lookAt(this.camLook);

    const R = this.rockMat.uniforms;
    (R.uCam.value as THREE.Vector3).copy(this.camPos);
    (R.uLamp.value as THREE.Vector3).set(pose.x + fx * 0.4, pose.y + 0.38, pose.z + fz * 0.4);
    (R.uLampDir.value as THREE.Vector3).set(fx, -0.18, fz).normalize();
    R.uTime.value = this.time;

    const ap = this.aheadFpv.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ap.count; i++) {
      const p = poseAtS(P, s + 0.5 + (5 * i) / (ap.count - 1));
      ap.setXYZ(i, p.x, p.y + 0.03, p.z);
    }
    ap.needsUpdate = true;

    this.mapMat.uniforms.uS.value = s;
    this.trail.geometry.setDrawRange(0, Math.floor(s / P.ds) + 1);
    this.axes.position.set(pose.x, this.mapY(pose.y) + 0.1, pose.z);
    this.axes.rotation.y = -pose.heading;

    const [cx, cz] = this.centre;
    const az = -2.0 + (s / P.length) * 0.5 + 0.04 * Math.sin(this.time * 0.2);
    const el = 0.56;
    const tx = cx + (pose.x - cx) * 0.08;
    const tz = cz + (pose.z - cz) * 0.08;
    const d = this.mapDist;
    this.mapCam.position.set(tx + d * Math.cos(el) * Math.cos(az), d * Math.sin(el), tz + d * Math.cos(el) * Math.sin(az));
    this.mapCam.lookAt(tx, 0, tz);

    const { w, h, renderer } = this;
    renderer.setScissorTest(true);
    const views: [THREE.Scene, THREE.Camera, number, number, number, number, number][] = this.vertical
      ? [
          [this.fpv, this.fpvCam, 0x050505, 0, Math.floor(h / 2), w, h - Math.floor(h / 2)],
          [this.map, this.mapCam, 0x232528, 0, 0, w, Math.floor(h / 2)],
        ]
      : [
          [this.fpv, this.fpvCam, 0x050505, 0, 0, Math.floor(w / 2), h],
          [this.map, this.mapCam, 0x232528, Math.floor(w / 2), 0, w - Math.floor(w / 2), h],
        ];
    for (const [scene, cam, clear, x, y, vw, vh] of views) {
      renderer.setClearColor(clear, 1);
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(scene, cam);
    }
  }
}
