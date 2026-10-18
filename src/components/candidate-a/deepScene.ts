/**
 * Candidate A — underground chapter. One WebGL context, two viewports:
 * the machine's headlit camera view of the passage, and the 2.5D risk map it
 * builds from its range sensor. Both are driven by path distance `s`.
 */
import * as THREE from 'three';
import { PASSAGE_RAMP, poseAtS, type Passage } from '../../lib/passage';

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

const finite = (a: Float32Array) => a.map((v) => (Number.isFinite(v) ? v : 1e6));

const MAP_VERT = /* glsl */ `
  attribute vec2 aCell;
  attribute float aH;
  attribute float aRisk;
  attribute float aS1;
  attribute float aR1;
  attribute float aS2;
  attribute float aR2;
  uniform float uS;
  uniform float uRange;
  uniform float uCell;
  uniform float uBase;
  uniform float uVS;
  uniform vec2 uPos;
  varying float vRisk;
  varying float vShade;
  varying float vKnown;
  varying float vFoot;
  varying vec2 vXZ;
  void main() {
    float known = step(aS1, uS);
    float rise = known * smoothstep(0.0, 1.5, uS - aS1);
    float r = uS >= aS2 ? aR2 : aR1;
    float unc = clamp(r / uRange, 0.0, 1.0);
    float h = mix(0.02, max(0.04, min(aH - uBase, 1.7) * uVS), rise);
    vec3 p = vec3((aCell.x + 0.5 + position.x * 0.94) * uCell, position.y * h, (aCell.y + 0.5 + position.z * 0.94) * uCell);
    vRisk = clamp(aRisk + 0.45 * unc * (1.0 - aRisk), 0.0, 1.0);
    vKnown = rise;
    vShade = normal.y > 0.5 ? 1.0 : (abs(normal.x) > 0.5 ? 0.62 : 0.46);
    vXZ = p.xz;
    vFoot = 1.0 - smoothstep(uRange * 0.9, uRange, distance(p.xz, uPos));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const MAP_FRAG = /* glsl */ `
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform float uTime;
  uniform vec2 uPos;
  varying float vRisk;
  varying float vShade;
  varying float vKnown;
  varying float vFoot;
  varying vec2 vXZ;
  vec3 ramp(float t) { return t < 0.5 ? mix(uC0, uC1, t / 0.5) : mix(uC1, uC2, (t - 0.5) / 0.5); }
  void main() {
    float hatch = step(0.8, fract((vXZ.x + vXZ.y) * 2.4));
    vec3 unknownCol = vec3(0.04, 0.043, 0.048) + vec3(0.36, 0.2, 0.08) * hatch * 0.32;
    float ang = atan(vXZ.y - uPos.y, vXZ.x - uPos.x);
    float sw = fract(ang / 6.2831853 - uTime * 0.35);
    float sweep = vFoot * smoothstep(0.88, 1.0, sw);
    vec3 col = mix(unknownCol, ramp(vRisk) * vShade, vKnown);
    col += vec3(0.66, 0.9, 1.0) * (sweep * 0.22 + vFoot * 0.03) * (1.0 - vKnown * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class DeepScene {
  private renderer: THREE.WebGLRenderer;
  private fpv = new THREE.Scene();
  private map = new THREE.Scene();
  private fpvCam = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
  private mapCam = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  private mapMat: THREE.ShaderMaterial;
  private trail: THREE.Line;
  private aheadMap: THREE.Line;
  private aheadFpv: THREE.Line;
  private ring: THREE.LineLoop;
  private marker = new THREE.Group();
  private vertical = false;
  private w = 1;
  private h = 1;
  private time = 0;
  private readonly VS = 0.55;

  constructor(private canvas: HTMLCanvasElement, private P: Passage, opts: { lowPower?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.5));
    this.renderer.setClearColor(0x050506, 1);

    /* machine view: grey rock, black fog, one headlight */
    this.fpv.fog = new THREE.FogExp2(0x050506, 0.17);
    const rock = new THREE.MeshStandardMaterial({ color: 0x6f6d69, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    this.fpv.add(new THREE.Mesh(surface(P, P.floor), rock));
    this.fpv.add(new THREE.Mesh(surface(P, P.ceil), rock));
    this.fpv.add(new THREE.AmbientLight(0xffffff, 0.04));
    const head = new THREE.SpotLight(0xfff1de, 16, 18, 0.72, 0.75, 1.5);
    head.position.set(0.12, 0.04, 0);
    const aim = new THREE.Object3D();
    aim.position.set(0, -0.35, -2);
    this.fpvCam.add(head, aim, new THREE.PointLight(0xdfe8ff, 0.5, 5, 2));
    head.target = aim;
    this.fpv.add(this.fpvCam);
    this.aheadFpv = dynLine(60, 0xffb347, 0.9);
    this.fpv.add(this.aheadFpv);

    /* risk map: one instanced box per cell */
    const n = P.n;
    const N = n * n;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.attributes.position);
    geo.setAttribute('normal', box.attributes.normal);
    geo.instanceCount = N;
    const cells = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) {
      cells[k * 2] = k % n;
      cells[k * 2 + 1] = Math.floor(k / n);
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    const attrs: [string, Float32Array][] = [
      ['aH', P.height], ['aRisk', P.risk], ['aS1', finite(P.s1)], ['aR1', finite(P.r1)], ['aS2', finite(P.s2)], ['aR2', finite(P.r2)],
    ];
    for (const [name, arr] of attrs) geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, 1));
    const c = (i: number) => new THREE.Vector3(...PASSAGE_RAMP[i].map((v) => v / 255));
    this.mapMat = new THREE.ShaderMaterial({
      vertexShader: MAP_VERT,
      fragmentShader: MAP_FRAG,
      uniforms: {
        uS: { value: 0 }, uRange: { value: P.range }, uCell: { value: P.cell }, uBase: { value: P.base },
        uVS: { value: this.VS }, uTime: { value: 0 }, uPos: { value: new THREE.Vector2() },
        uC0: { value: c(0) }, uC1: { value: c(1) }, uC2: { value: c(2) },
      },
    });
    const cellsMesh = new THREE.Mesh(geo, this.mapMat);
    cellsMesh.frustumCulled = false;
    this.map.add(cellsMesh);

    this.trail = dynLine(P.path.length, 0xebe7de, 0.6);
    const tp = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    P.path.forEach((p, i) => tp.setXYZ(i, p.x, this.mapY(p.y) + 0.08, p.z));
    this.map.add(this.trail);
    this.aheadMap = dynLine(40, 0xffb347, 1);
    this.map.add(this.aheadMap);

    const ringG = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 72 }, (_, i) => new THREE.Vector3(Math.cos((i / 72) * Math.PI * 2) * P.range, 0, Math.sin((i / 72) * Math.PI * 2) * P.range)),
    );
    this.ring = new THREE.LineLoop(ringG, new THREE.LineBasicMaterial({ color: 0xa8e6ff, transparent: true, opacity: 0.3 }));
    this.map.add(this.ring);

    const cone = new THREE.ConeGeometry(0.34, 0.95, 3);
    cone.rotateZ(-Math.PI / 2);
    this.marker.add(new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0x060708 })));
    this.marker.add(new THREE.LineSegments(new THREE.EdgesGeometry(cone), new THREE.LineBasicMaterial({ color: 0xebe7de })));
    this.map.add(this.marker);
  }

  private mapY(y: number) {
    return Math.max(0.04, (y - this.P.base) * this.VS);
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.vertical = this.w / this.h < 1;
    const fa = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.fpvCam.aspect = fa;
    this.mapCam.aspect = fa;
    this.mapCam.fov = this.vertical ? 38 : 30;
    this.fpvCam.updateProjectionMatrix();
    this.mapCam.updateProjectionMatrix();
  }

  private fillAhead(l: THREE.Line, from: number, to: number, y: (p: { y: number }) => number) {
    const pos = l.geometry.attributes.position as THREE.BufferAttribute;
    const K = pos.count;
    for (let i = 0; i < K; i++) {
      const p = poseAtS(this.P, from + ((to - from) * i) / (K - 1));
      pos.setXYZ(i, p.x, y(p), p.z);
    }
    pos.needsUpdate = true;
  }

  frame(dt: number, s: number) {
    const P = this.P;
    this.time += dt;
    s = Math.min(P.length - 0.01, Math.max(0, s));
    const pose = poseAtS(P, s);

    const bob = Math.sin(s * 7) * 0.01;
    this.fpvCam.position.set(pose.x, pose.y + 0.55 + bob, pose.z);
    this.fpvCam.lookAt(pose.x + Math.cos(pose.heading) * 1.8, pose.y + 0.38, pose.z + Math.sin(pose.heading) * 1.8);
    this.fillAhead(this.aheadFpv, s + 0.4, s + 4.5, (p) => p.y + 0.035);

    const U = this.mapMat.uniforms;
    U.uS.value = s;
    U.uTime.value = this.time;
    (U.uPos.value as THREE.Vector2).set(pose.x, pose.z);
    this.trail.geometry.setDrawRange(0, Math.floor(s / P.ds) + 1);
    this.fillAhead(this.aheadMap, s, s + 4, (p) => this.mapY(p.y) + 0.12);
    this.ring.position.set(pose.x, this.mapY(pose.y) + 0.05, pose.z);
    this.marker.position.set(pose.x, this.mapY(pose.y) + 0.35, pose.z);
    this.marker.rotation.y = -pose.heading;

    const C = P.extent / 2;
    const q = s / P.length;
    const az = -1.95 + q * 0.8 + 0.05 * Math.sin(this.time * 0.2);
    const el = 1.0;
    const dist = this.vertical ? 58 : 50;
    const tx = C + (pose.x - C) * 0.12;
    const tz = C + (pose.z - C) * 0.12;
    this.mapCam.position.set(tx + dist * Math.cos(el) * Math.cos(az), dist * Math.sin(el), tz + dist * Math.cos(el) * Math.sin(az));
    this.mapCam.lookAt(tx, 0, tz);

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
