/**
 * Candidate A — "The Machine's Eyes" WebGL scene.
 * One procedural world rendered two ways: as reality, and as the machine's
 * belief (known / unknown terrain, risk, candidate trajectories).
 */
import * as THREE from 'three';
import {
  createWorld,
  findSpot,
  KnowledgeMap,
  planArcs,
  poseAt,
  PROFILES,
  riskAt,
  smoothstep,
  rollout,
  sample,
  type EmbodimentId,
  type Pose,
  type RiskProfile,
  type World,
} from '../../lib/world';
import { A_EXTENT, A_GOAL, A_HUB, A_WORLD } from './worldA';

export interface SceneState {
  relief: number;
  structured: number;
  belief: number;
  points: number;
  risk: number;
  field: number;
  plans: number;
  lens: number;
  known: number;
  profile: number;
  team: number;
  others: number;
  dist: number;
  elev: number;
  azim: number;
  focus: number;
  dim: number;
  halt: number;
  comm: number;
  bev: number;
}

export const INITIAL_STATE: SceneState = {
  relief: 1, structured: 0, belief: 0, points: 0, risk: 0, field: 0, plans: 0, lens: 1, known: 0,
  profile: 0, team: 0, others: 0, dist: 2.6, elev: 0.3, azim: 0.9, focus: 0, dim: 0, halt: 0, comm: 0, bev: 0,
};

const EXTENT = A_EXTENT;
const HSCALE = 0.9;
const FIELD_AMP = 0.5;
const FIELD_BASE = 0.3;
const BG = new THREE.Color('#060708');
const PROFILE_ORDER: EmbodimentId[] = ['ugv', 'uav', 'legged', 'maritime'];

function boxBlur(src: Float32Array, n: number, r: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let a = 0;
      let c = 0;
      for (let d = -r; d <= r; d++) {
        const x = i + d;
        if (x >= 0 && x < n) (a += src[j * n + x]), c++;
      }
      tmp[j * n + i] = a / c;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let a = 0;
      let c = 0;
      for (let d = -r; d <= r; d++) {
        const y = j + d;
        if (y >= 0 && y < n) (a += tmp[y * n + i]), c++;
      }
      out[j * n + i] = a / c;
    }
  }
  return out;
}

const toXZ = (u: number, v: number) => [(u - 0.5) * EXTENT, (v - 0.5) * EXTENT] as const;

/* ------------------------------------------------------------------ shaders */

const terrainVert = /* glsl */ `
  attribute float aHeight;
  attribute vec4 aHaz;
  uniform float uRelief;
  uniform float uHScale;
  uniform float uFieldMix;
  varying vec3 vWorld;
  varying float vH;
  varying vec4 vHaz;
  void main() {
    vec3 p = position;
    float base = aHeight * uHScale * uRelief;
    p.y = mix(base, aHeight * uHScale * ${FIELD_BASE.toFixed(2)} + aHaz.w * ${FIELD_AMP.toFixed(2)}, uFieldMix);
    vH = aHeight;
    vHaz = aHaz;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const terrainFrag = /* glsl */ `
  uniform sampler2D uField;
  uniform sampler2D uKnow;
  uniform float uExtent, uStructured, uBelief, uRisk, uLens, uLensR, uKnown, uDim, uTime;
  uniform float uUnknownW, uSensorR, uTeam;
  uniform vec4 uProfile;
  uniform vec2 uMouse, uRobot;
  uniform vec3 uBg;
  uniform float uHScale, uRelief;
  uniform float uFieldMix;
  varying vec3 vWorld;
  varying float vH;
  varying vec4 vHaz;

  float aaLine(float x, float w) {
    float d = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-4);
    return 1.0 - clamp(d - w, 0.0, 1.0);
  }
  vec3 riskRamp(float t) {
    vec3 a = vec3(0.11, 0.07, 0.04), b = vec3(0.59, 0.32, 0.09), c = vec3(1.0, 0.47, 0.19);
    return t < 0.55 ? mix(a, b, t / 0.55) : mix(b, c, (t - 0.55) / 0.45);
  }

  void main() {
    vec2 fuv = vWorld.xz / uExtent + 0.5;
    vec4 f = texture2D(uField, fuv);
    float h01 = f.r, slope = f.g, threat = f.b, water = f.a;
    float e = 1.5 / 192.0;
    float hx = texture2D(uField, fuv + vec2(e, 0.0)).r - texture2D(uField, fuv - vec2(e, 0.0)).r;
    float hz = texture2D(uField, fuv + vec2(0.0, e)).r - texture2D(uField, fuv - vec2(0.0, e)).r;
    float k = 2.0 * uHScale * uRelief / (2.0 * e * uExtent) * 2.0;
    vec3 N = normalize(vec3(-hx * k, 1.0, -hz * k));
    float diff = clamp(dot(N, normalize(vec3(-0.55, 0.55, -0.35))), 0.0, 1.0);
    float rim = pow(1.0 - clamp(N.y, 0.0, 1.0), 2.0);

    /* --- reality --- */
    vec3 low = vec3(0.13, 0.125, 0.11), high = vec3(0.47, 0.43, 0.37);
    vec3 ground = mix(low, high, smoothstep(0.25, 0.95, h01));
    ground = mix(ground, vec3(0.24, 0.22, 0.2), slope * 0.5);
    vec3 real = ground * (0.22 + 1.05 * diff) + rim * 0.04;
    float glint = pow(diff, 18.0);
    real = mix(real, vec3(0.035, 0.05, 0.065) + glint * 0.25 + 0.04 * diff, water);

    /* --- structured world (clean grid, roads) --- */
    vec2 g = vWorld.xz;
    float grid = aaLine(g.x * 2.0, 0.0) + aaLine(g.y * 2.0, 0.0);
    float roadX = 1.0 - smoothstep(0.1, 0.12, abs(fract(g.x / 2.5) - 0.5) * 2.5);
    float roadZ = 1.0 - smoothstep(0.1, 0.12, abs(fract(g.y / 2.5) - 0.5) * 2.5);
    float road = max(roadX, roadZ);
    float laneX = roadX * (1.0 - smoothstep(0.0, fwidth(g.x) * 1.5, abs(fract(g.x / 2.5) - 0.5) * 2.5)) * step(0.5, fract(g.y * 2.0));
    float laneZ = roadZ * (1.0 - smoothstep(0.0, fwidth(g.y) * 1.5, abs(fract(g.y / 2.5) - 0.5) * 2.5)) * step(0.5, fract(g.x * 2.0));
    float lane = max(laneX, laneZ);
    vec3 clean = vec3(0.1, 0.105, 0.11) + grid * 0.06 + road * 0.05 + lane * 0.35;
    real = mix(real, clean, uStructured);
    real *= 1.0 - uDim * 0.85;

    /* --- belief --- */
    float ld = length(gl_FragCoord.xy - uMouse);
    float lens = uLens * (1.0 - smoothstep(uLensR - 1.5, uLensR, ld));
    float know = clamp(texture2D(uKnow, fuv).r + uKnown, 0.0, 1.0);
    know = max(know, lens * (1.0 - uBelief) * smoothstep(3.2, 0.6, length(vWorld.xz - uRobot)) * 0.85);
    float cl = aaLine(vH * 14.0, 0.0);
    float clMajor = aaLine(vH * 3.5, 0.3);
    vec3 bel = vec3(0.028, 0.032, 0.038) + diff * 0.03 * know;
    bel += vec3(0.72, 0.76, 0.78) * (cl * 0.32 + clMajor * 0.3) * know;
    bel = mix(bel, bel + vec3(0.02, 0.05, 0.08), water * know);
    vec2 cell = fract(g * 16.0) - 0.5;
    float dots = 1.0 - smoothstep(0.06, 0.06 + fwidth(g.x * 16.0) * 1.2, length(cell));
    float flicker = 0.6 + 0.4 * sin(uTime * 2.0 + dot(floor(g * 16.0), vec2(12.9898, 78.233)));
    bel += vec3(0.42, 0.55, 0.66) * dots * 0.32 * (1.0 - know) * flicker;
    float frontier = smoothstep(0.08, 0.35, know) * (1.0 - smoothstep(0.35, 0.8, know));
    bel += vec3(0.66, 0.9, 1.0) * frontier * 0.1;
    float rd = length(vWorld.xz - uRobot);
    float ring = 1.0 - clamp(abs(rd - uSensorR) / max(fwidth(rd), 1e-4) - 0.5, 0.0, 1.0);
    bel += vec3(0.66, 0.9, 1.0) * ring * 0.35 * step(0.5, fract(atan(vWorld.z - uRobot.y, vWorld.x - uRobot.x) * 12.0)) * (1.0 - uTeam);

    /* --- risk --- */
    float terrain = min(1.0, uProfile.x * slope + uProfile.y * water + uProfile.z * (1.0 - water));
    float risk = 1.0 - (1.0 - terrain) * (1.0 - uProfile.w * threat) * (1.0 - uUnknownW * 0.6 * (1.0 - know));
    vec3 rc = riskRamp(risk);
    float rAmt = uRisk * smoothstep(0.22, 0.85, risk);
    bel = mix(bel, bel * 0.6 + rc * 0.7, rAmt * 0.85);
    float tRing = aaLine(threat * 6.0, 0.0) * smoothstep(0.08, 0.25, threat);
    bel += vec3(1.0, 0.4, 0.2) * tRing * 0.4 * uRisk * uProfile.w;

    /* --- risk field: terrain / ambiguous sensing / electronic warfare, raised as cost --- */
    if (uFieldMix > 0.001) {
      vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      if (Nf.y < 0.0) Nf = -Nf;
      float df = clamp(dot(Nf, normalize(vec3(-0.55, 0.55, -0.35))), 0.0, 1.0);
      float wt = vHaz.x, wa = vHaz.y * 1.9, we = vHaz.z * 0.9, rt = vHaz.w;
      vec3 tc = (vec3(1.0, 0.66, 0.16) * wt + vec3(0.62, 0.45, 1.0) * wa + vec3(1.0, 0.22, 0.16) * we) / (wt + wa + we + 1e-3);
      float I = smoothstep(0.04, 0.55, rt);
      vec3 fc = vec3(0.045, 0.04, 0.036) * (0.4 + 1.2 * df);
      fc = mix(fc, tc * (0.3 + 0.9 * df), I);
      fc += vec3(0.9, 0.86, 0.8) * aaLine(rt * 8.0, 0.0) * 0.14 * smoothstep(0.03, 0.12, rt);
      bel = mix(bel, fc + bel * 0.25, uFieldMix);
    }

    /* --- compose: reality vs machine view, cursor lens --- */
    float lensRing = uLens * (1.0 - clamp(abs(ld - uLensR) - 0.5, 0.0, 1.0));
    float m = clamp(uBelief + lens, 0.0, 1.0);
    vec3 col = mix(real, bel, m);
    col += vec3(0.85, 0.85, 0.8) * lensRing * 0.5;

    float dist = length(vWorld - cameraPosition);
    float fog = smoothstep(4.0, 15.0, dist);
    float edge = smoothstep(0.38, 0.5, max(abs(fuv.x - 0.5), abs(fuv.y - 0.5)));
    col = mix(col, uBg, clamp(fog + edge, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const pointsVert = /* glsl */ `
  attribute vec2 aRing;
  uniform sampler2D uField;
  uniform vec2 uRobot;
  uniform float uExtent, uHScale, uRelief, uTime, uSize, uMaxR, uWater;
  varying float vA;
  void main() {
    float r = aRing.x;
    float a = aRing.y;
    vec2 xz = uRobot + vec2(cos(a), sin(a)) * r;
    vec2 fuv = xz / uExtent + 0.5;
    float h = max(texture2D(uField, fuv).r * 2.0 - 1.0, uWater);
    vec3 p = vec3(xz.x, h * uHScale * uRelief + 0.012, xz.y);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize / -mv.z;
    float sweep = fract(a / 6.28318 - uTime * 0.45);
    float sw = pow(1.0 - sweep, 5.0);
    float fall = 1.0 - smoothstep(uMaxR * 0.55, uMaxR, r);
    vA = (0.3 + 0.7 * sw) * fall;
  }
`;

const pointsFrag = /* glsl */ `
  uniform float uPoints, uLens, uLensR;
  uniform vec2 uMouse;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    float ld = length(gl_FragCoord.xy - uMouse);
    float lens = uLens * (1.0 - smoothstep(uLensR - 1.5, uLensR, ld));
    float a = vA * max(uPoints, lens * 0.8);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.7, 0.9, 1.0) * a, a);
  }
`;

/* ------------------------------------------------------------------ helpers */

class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly mat: THREE.MeshBasicMaterial;
  constructor(private n: number, color: THREE.ColorRepresentation) {
    this.pos = new Float32Array(n * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  update(pts: [number, number, number][], width: number) {
    const n = Math.min(this.n, pts.length);
    for (let i = 0; i < this.n; i++) {
      const p = pts[Math.min(i, n - 1)];
      const q = pts[Math.min(i + 1, n - 1)];
      const o = pts[Math.max(i - 1, 0)];
      let dx = q[0] - o[0];
      let dz = q[2] - o[2];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const k = i * 6;
      this.pos[k] = p[0] - dz * width;
      this.pos[k + 1] = p[1];
      this.pos[k + 2] = p[2] + dx * width;
      this.pos[k + 3] = p[0] + dz * width;
      this.pos[k + 4] = p[1];
      this.pos[k + 5] = p[2] - dx * width;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Model {
  group: THREE.Group;
  setOpacity(o: number): void;
}

function makeModel(id: EmbodimentId): Model {
  const group = new THREE.Group();
  const solid = new THREE.MeshBasicMaterial({ color: 0x0b0c0d, transparent: true });
  const edge = new THREE.LineBasicMaterial({ color: 0xebe7de, transparent: true });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, solid);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edge);
    m.add(e);
    group.add(m);
  };
  const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
  const cyl = (r: number, h: number, s = 12) => new THREE.CylinderGeometry(r, r, h, s);
  if (id === 'ugv') {
    add(box(0.24, 0.05, 0.13), 0, 0.06, 0);
    add(box(0.07, 0.035, 0.07), 0.03, 0.1, 0);
    add(cyl(0.006, 0.07, 6), 0.05, 0.15, 0);
    for (const x of [-0.08, 0, 0.08]) for (const z of [-0.075, 0.075]) add(cyl(0.03, 0.022), x, 0.03, z, Math.PI / 2);
  } else if (id === 'uav') {
    add(box(0.07, 0.025, 0.07), 0, 0, 0);
    add(box(0.26, 0.008, 0.014), 0, 0, 0, 0, Math.PI / 4);
    add(box(0.26, 0.008, 0.014), 0, 0, 0, 0, -Math.PI / 4);
    for (const [x, z] of [[0.09, 0.09], [-0.09, 0.09], [0.09, -0.09], [-0.09, -0.09]]) add(cyl(0.05, 0.004, 16), x, 0.016, z);
    add(box(0.03, 0.025, 0.03), 0.01, -0.025, 0);
  } else if (id === 'legged') {
    add(box(0.2, 0.05, 0.09), 0, 0.13, 0);
    add(box(0.045, 0.035, 0.06), 0.12, 0.145, 0);
    for (const x of [-0.075, 0.075]) for (const z of [-0.055, 0.055]) {
      add(box(0.016, 0.065, 0.016), x, 0.09, z, 0, 0, x > 0 ? 0.35 : -0.35);
      add(box(0.014, 0.065, 0.014), x, 0.032, z, 0, 0, x > 0 ? -0.35 : 0.35);
    }
  } else {
    add(box(0.28, 0.04, 0.1), 0, 0.02, 0);
    add(new THREE.ConeGeometry(0.05, 0.08, 4), 0.18, 0.02, 0, 0, Math.PI / 4, -Math.PI / 2);
    add(box(0.08, 0.045, 0.065), -0.02, 0.064, 0);
    add(cyl(0.005, 0.1, 6), 0, 0.13, 0);
  }
  return {
    group,
    setOpacity(o: number) {
      solid.opacity = o;
      edge.opacity = o;
      group.visible = o > 0.01;
    },
  };
}

interface Agent {
  id: EmbodimentId;
  model: Model;
  pose: () => Pose & { hover: number };
  revealR: number;
  cluster: boolean;
}

/* ------------------------------------------------------------------ scene */

export class EyesScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
  private world: World;
  private terrainMat: THREE.ShaderMaterial;
  private pointsMat: THREE.ShaderMaterial;
  private knowledge = new KnowledgeMap(128);
  private knowData = new Uint8Array(128 * 128);
  private knowTex: THREE.DataTexture;
  private mainPath: Pose[];
  private agents: Agent[] = [];
  private main!: Agent;
  private ribbons: Ribbon[] = [];
  private best: Ribbon;
  private trail: Ribbon;
  private links: THREE.LineSegments;
  private linkPos = new Float32Array(64 * 3);
  private pulses: THREE.Points;
  private pulsePos = new Float32Array(32 * 3);
  private operator: THREE.Group;
  private operatorUV = { u: 0.5, v: 0.5 };
  private clusterCenter = { u: 0.5, v: 0.5 };
  private camTarget = new THREE.Vector3();
  private mouse = new THREE.Vector2(-1e4, -1e4);
  private lastPointer = -100;
  private time = 0;
  private hazH!: Float32Array;
  private fieldAmt = 0;
  private profile: RiskProfile = { ...PROFILES.ugv };
  readonly goal = A_GOAL;
  private mainPhase = 0;
  private stopPhase = 0.5;
  private comm: THREE.Line;
  private commPos = new Float32Array(48 * 3);
  private commPulses: THREE.Points;
  private commPulsePos = new Float32Array(5 * 3);
  activeEmbodiment: EmbodimentId = 'ugv';

  constructor(private canvas: HTMLCanvasElement, opts: { lowPower?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1.25 : 1.75));
    this.renderer.setClearColor(BG, 1);

    const world = (this.world = createWorld(A_WORLD));
    const S = world.size;

    /* field texture */
    const field = new Uint8Array(S * S * 4);
    for (let k = 0; k < S * S; k++) {
      field[k * 4] = (world.height[k] * 0.5 + 0.5) * 255;
      field[k * 4 + 1] = world.slope[k] * 255;
      field[k * 4 + 2] = world.threat[k] * 255;
      field[k * 4 + 3] = world.water[k] * 255;
    }
    const fieldTex = new THREE.DataTexture(field, S, S, THREE.RGBAFormat);
    fieldTex.magFilter = fieldTex.minFilter = THREE.LinearFilter;
    fieldTex.needsUpdate = true;

    this.knowTex = new THREE.DataTexture(this.knowData, 128, 128, THREE.RedFormat);
    this.knowTex.magFilter = this.knowTex.minFilter = THREE.LinearFilter;
    this.knowTex.needsUpdate = true;

    /* terrain */
    const seg = opts.lowPower ? 160 : 256;
    const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const aH = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / EXTENT + 0.5;
      const v = pos.getZ(i) / EXTENT + 0.5;
      aH[i] = Math.max(sample(world.height, S, u, v), world.waterLevel);
    }
    geo.setAttribute('aHeight', new THREE.BufferAttribute(aH, 1));
    const slopeR = boxBlur(world.slope, S, 3).map((x) => smoothstep(0.3, 0.85, x));
    /* risk sources: terrain, ambiguous sensing, electronic warfare */
    const terrainR = new Float32Array(S * S);
    this.hazH = new Float32Array(S * S);
    for (let k = 0; k < S * S; k++) {
      terrainR[k] = 1 - (1 - slopeR[k]) * (1 - world.obstacle[k]) * (1 - world.negative[k]);
      this.hazH[k] = 1 - (1 - terrainR[k]) * (1 - 0.9 * world.ambiguity[k]) * (1 - 0.7 * world.threat[k]);
    }
    const aHaz = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / EXTENT + 0.5;
      const v = pos.getZ(i) / EXTENT + 0.5;
      aHaz[i * 4] = sample(terrainR, S, u, v);
      aHaz[i * 4 + 1] = sample(world.ambiguity, S, u, v);
      aHaz[i * 4 + 2] = sample(world.threat, S, u, v);
      aHaz[i * 4 + 3] = sample(this.hazH, S, u, v);
    }
    geo.setAttribute('aHaz', new THREE.BufferAttribute(aHaz, 4));

    const common = {
      uField: { value: fieldTex },
      uExtent: { value: EXTENT },
      uHScale: { value: HSCALE },
      uRelief: { value: 1 },
      uMouse: { value: this.mouse },
      uLens: { value: 1 },
      uLensR: { value: 200 },
      uRobot: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    };
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
      uniforms: {
        ...common,
        uKnow: { value: this.knowTex },
        uStructured: { value: 0 },
        uBelief: { value: 0 },
        uRisk: { value: 0 },
        uFieldMix: { value: 0 },
        uKnown: { value: 0 },
        uDim: { value: 0 },
        uUnknownW: { value: 0.55 },
        uSensorR: { value: 0.9 },
        uTeam: { value: 0 },
        uProfile: { value: new THREE.Vector4() },
        uBg: { value: BG },
      },
    });
    this.scene.add(new THREE.Mesh(geo, this.terrainMat));

    /* lidar-like point rings around the robot */
    const rings = opts.lowPower ? 36 : 56;
    const perRing = opts.lowPower ? 360 : 520;
    const ring = new Float32Array(rings * perRing * 2);
    let p = 0;
    for (let r = 0; r < rings; r++) {
      const rad = 0.08 + Math.pow(r / rings, 1.35) * 1.5;
      for (let a = 0; a < perRing; a++) {
        ring[p++] = rad + (Math.random() - 0.5) * 0.01;
        ring[p++] = (a / perRing) * Math.PI * 2 + r * 0.013;
      }
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('aRing', new THREE.BufferAttribute(ring, 2));
    pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rings * perRing * 3), 3));
    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: pointsVert,
      fragmentShader: pointsFrag,
      uniforms: {
        ...common,
        uSize: { value: 6 * this.renderer.getPixelRatio() },
        uMaxR: { value: 1.6 },
        uPoints: { value: 0 },
        uWater: { value: world.waterLevel },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(pgeo, this.pointsMat);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.scene.add(pts);

    /* paths & agents */
    const riskStatic = (u: number, v: number) => riskAt(world, u, v, 1, PROFILES.ugv);
    const fwd = rollout({ u: 0.16, v: 0.78, heading: -0.4 }, this.goal, riskStatic, 140, { execute: 2, length: 0.18 });
    const end = fwd[fwd.length - 1];
    const back = rollout({ ...end, heading: end.heading + Math.PI }, { u: 0.16, v: 0.78 }, riskStatic, 140, {
      execute: 2,
      length: 0.18,
    });
    this.mainPath = [...fwd, ...back];
    this.stopPhase = (fwd.length - 1) / (this.mainPath.length - 1);

    const addAgent = (
      id: EmbodimentId,
      pose: () => Pose & { hover: number },
      revealR: number,
      cluster: boolean,
    ) => {
      const model = makeModel(id);
      model.group.scale.setScalar(1.25);
      this.scene.add(model.group);
      const a: Agent = { id, model, pose, revealR, cluster };
      this.agents.push(a);
      return a;
    };

    this.main = addAgent('ugv', () => ({ ...poseAt(this.mainPath, this.mainPhase), hover: 0 }), 0.09, false);

    /* embodiment cluster around a lake */
    const C = (this.clusterCenter = findSpot(world, (u, v, k) => {
      if (world.water[k] < 0.95) return -Infinity;
      let deep = 0;
      for (let d = 1; d <= 4; d++) deep += sample(world.water, S, u + d * 0.01, v) + sample(world.water, S, u - d * 0.01, v);
      return deep - Math.hypot(u - 0.45, v - 0.55) * 12;
    }));
    const legged = findSpot(world, (u, v, k) => {
      const d = Math.hypot(u - C.u, v - C.v);
      if (d > 0.16 || d < 0.07 || world.water[k] > 0.05) return -Infinity;
      return world.slope[k] - d;
    });
    const flatA = findSpot(world, (u, v, k) => {
      const d = Math.hypot(u - C.u, v - C.v);
      if (d > 0.2 || d < 0.08 || world.water[k] > 0.02) return -Infinity;
      return -world.slope[k] - Math.abs(Math.atan2(v - C.v, u - C.u) - Math.atan2(C.v - legged.v, C.u - legged.u));
    });
    const flatB = findSpot(world, (u, v, k) => {
      const d = Math.hypot(u - flatA.u, v - flatA.v);
      if (d > 0.14 || d < 0.08 || world.water[k] > 0.02) return -Infinity;
      return -world.slope[k] * 2 - Math.hypot(u - C.u, v - C.v);
    });
    const rStatic = (u: number, v: number) => riskAt(world, u, v, 1, PROFILES.ugv);
    const ugvLocal = [
      ...rollout({ ...flatA, heading: 0 }, flatB, rStatic, 40, { execute: 2, length: 0.08 }),
      ...rollout({ ...flatB, heading: Math.PI }, flatA, rStatic, 40, { execute: 2, length: 0.08 }),
    ];
    const lp = ugvLocal.length * 0.4;
    addAgent('ugv', () => ({ ...poseAt(ugvLocal, (this.time / lp) % 1), hover: 0 }), 0.07, true);
    addAgent('uav', () => {
      const a = this.time * 0.18;
      return { u: C.u + Math.cos(a) * 0.07, v: C.v + Math.sin(a) * 0.07, heading: a + Math.PI / 2, hover: 0.55 };
    }, 0.14, true);
    addAgent('legged', () => {
      const s = Math.sin(this.time * 0.25) * 0.012;
      return { u: legged.u + s, v: legged.v + s * 0.5, heading: Math.atan2(C.v - legged.v, C.u - legged.u), hover: 0 };
    }, 0.07, true);
    addAgent('maritime', () => {
      const a = this.time * 0.07;
      return { u: C.u + Math.cos(a) * 0.025, v: C.v + Math.sin(a) * 0.025, heading: a + Math.PI / 2, hover: 0 };
    }, 0.08, true);

    /* team extras (wider operating area) */
    const far = rollout({ u: 0.85, v: 0.8, heading: Math.PI }, { u: 0.55, v: 0.15 }, rStatic, 120, { execute: 2 });
    const farPath = [...far, ...far.slice().reverse().map((p) => ({ ...p, heading: p.heading + Math.PI }))];
    const fp = farPath.length * 0.45;
    addAgent('ugv', () => ({ ...poseAt(farPath, (this.time / fp + 0.3) % 1), hover: 0 }), 0.08, false);
    addAgent('uav', () => {
      const a = this.time * 0.11 + 2;
      return { u: 0.5 + Math.cos(a) * 0.28, v: 0.5 + Math.sin(a * 1.3) * 0.22, heading: a, hover: 0.8 };
    }, 0.16, false);

    /* operator marker */
    this.operatorUV = findSpot(world, (u, v, k) =>
      world.water[k] > 0.05 ? -Infinity : world.height[k] - Math.hypot(u - 0.22, v - 0.25) * 4,
    );
    this.operator = new THREE.Group();
    const opMat = new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true });
    const oct = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.09)), opMat);
    oct.position.y = 0.9;
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.8, 0)]),
      opMat,
    );
    this.operator.add(oct, stem);
    this.scene.add(this.operator);

    /* links + pulses */
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.linkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.links = new THREE.LineSegments(
      lgeo,
      new THREE.LineBasicMaterial({ color: 0xa8e6ff, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.links.frustumCulled = false;
    this.scene.add(this.links);
    const pgeo2 = new THREE.BufferGeometry();
    pgeo2.setAttribute('position', new THREE.BufferAttribute(this.pulsePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pulses = new THREE.Points(
      pgeo2,
      new THREE.PointsMaterial({ color: 0xffd9a0, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.pulses.frustumCulled = false;
    this.scene.add(this.pulses);

    /* comms link: arcs from the stopped vehicle towards the Shunya OS node */
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.BufferAttribute(this.commPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.comm = new THREE.Line(cgeo, new THREE.LineBasicMaterial({ color: 0xa8e6ff, transparent: true, opacity: 0, depthWrite: false }));
    this.comm.frustumCulled = false;
    this.comm.renderOrder = 3;
    const cpg = new THREE.BufferGeometry();
    cpg.setAttribute('position', new THREE.BufferAttribute(this.commPulsePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.commPulses = new THREE.Points(
      cpg,
      new THREE.PointsMaterial({ color: 0xe6f7ff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.commPulses.frustumCulled = false;
    this.commPulses.renderOrder = 3;
    this.scene.add(this.comm, this.commPulses);

    /* trajectories */
    for (let i = 0; i < 15; i++) {
      const r = new Ribbon(23, 0xebe7de);
      this.ribbons.push(r);
      this.scene.add(r.mesh);
    }
    this.best = new Ribbon(23, 0xa8e6ff);
    this.trail = new Ribbon(80, 0xebe7de);
    this.scene.add(this.best.mesh, this.trail.mesh);
  }

  /** Current pose of the lead ground vehicle, in world u/v. */
  mainPose(): Pose {
    return poseAt(this.mainPath, this.mainPhase);
  }

  groundY(u: number, v: number) {
    const w = this.world;
    const h = Math.max(sample(w.height, w.size, u, v), w.waterLevel);
    const base = h * HSCALE * (this.terrainMat?.uniforms.uRelief.value ?? 1);
    if (!this.fieldAmt) return base;
    const fy = h * HSCALE * FIELD_BASE + sample(this.hazH, w.size, u, v) * FIELD_AMP;
    return base + (fy - base) * this.fieldAmt;
  }

  setPointer(x: number, y: number) {
    const pr = this.renderer.getPixelRatio();
    this.mouse.set(x * pr, (this.canvas.clientHeight - y) * pr);
    this.lastPointer = this.time;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 700 ? 55 : 42;
    this.camera.updateProjectionMatrix();
    this.terrainMat.uniforms.uLensR.value = Math.min(w, h) * 0.22 * this.renderer.getPixelRatio();
    this.pointsMat.uniforms.uLensR.value = this.terrainMat.uniforms.uLensR.value;
  }

  frame(dt: number, s: SceneState) {
    this.time += dt;
    const t = this.time;
    const U = this.terrainMat.uniforms;
    const P = this.pointsMat.uniforms;

    /* risk profile morph across embodiments */
    const pi = Math.min(PROFILE_ORDER.length - 1, Math.max(0, s.profile));
    const i0 = Math.floor(pi);
    const i1 = Math.min(PROFILE_ORDER.length - 1, i0 + 1);
    const f = pi - i0;
    const a = PROFILES[PROFILE_ORDER[i0]];
    const b = PROFILES[PROFILE_ORDER[i1]];
    const mix = (x: number, y: number) => x + (y - x) * f;
    const ugvW = 1 - s.others;
    this.profile = {
      slope: mix(a.slope, b.slope) * (1 - ugvW) + PROFILES.ugv.slope * ugvW,
      water: mix(a.water, b.water) * (1 - ugvW) + PROFILES.ugv.water * ugvW,
      land: mix(a.land, b.land) * (1 - ugvW),
      threat: mix(a.threat, b.threat) * (1 - ugvW) + PROFILES.ugv.threat * ugvW,
      unknown: mix(a.unknown, b.unknown) * (1 - ugvW) + PROFILES.ugv.unknown * ugvW,
    };
    this.activeEmbodiment = PROFILE_ORDER[Math.round(pi)];

    U.uRelief.value = s.relief;
    U.uStructured.value = s.structured;
    U.uBelief.value = s.belief;
    U.uRisk.value = s.risk;
    U.uFieldMix.value = s.field;
    this.fieldAmt = s.field;
    U.uKnown.value = s.known;
    U.uDim.value = s.dim;
    U.uTeam.value = s.team;
    U.uUnknownW.value = this.profile.unknown;
    (U.uProfile.value as THREE.Vector4).set(this.profile.slope, this.profile.water, this.profile.land, this.profile.threat);
    U.uTime.value = t;
    P.uPoints.value = s.points;

    /* lens: follow pointer, or wander on its own when idle */
    U.uLens.value = s.lens;
    if (t - this.lastPointer > 4) {
      const pr = this.renderer.getPixelRatio();
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const tx = (0.62 + Math.sin(t * 0.33) * 0.16) * w * pr;
      const ty = (0.45 + Math.cos(t * 0.27) * 0.14) * h * pr;
      const k = this.mouse.x < -1000 ? 1 : 1 - Math.exp(-dt * 2);
      this.mouse.x += (tx - this.mouse.x) * k;
      this.mouse.y += (ty - this.mouse.y) * k;
    }

    /* main vehicle: drives its loop, or heads to the goal and stops */
    const period = this.mainPath.length * 0.42;
    if (s.halt > 0.02) {
      const gap = (this.stopPhase - this.mainPhase + 1) % 1;
      const step = (dt / period) * (1 + 8 * s.halt);
      /* arrived (or a rounding hair past the stop): stay put instead of looping again */
      if (gap <= step || gap > 1 - 1e-3) this.mainPhase = this.stopPhase;
      else this.mainPhase = (this.mainPhase + step) % 1;
    } else {
      this.mainPhase = (this.mainPhase + dt / period) % 1;
    }

    /* agents */
    const decay = Math.exp(-dt * 0.02);
    this.knowledge.decay(decay);
    const fill = 1 - Math.exp(-dt * 5);
    let mainPose: Pose = this.main.pose();
    for (const ag of this.agents) {
      const p = ag.pose();
      const [x, z] = toXZ(p.u, p.v);
      ag.model.group.position.set(x, this.groundY(p.u, p.v) + p.hover + (ag.id === 'uav' ? Math.sin(t * 2 + x) * 0.02 : 0), z);
      ag.model.group.rotation.y = -p.heading;
      let vis: number;
      if (ag === this.main) {
        vis = 1 - s.others * (1 - s.team);
        mainPose = p;
      } else if (ag.cluster) {
        vis = Math.max(s.others, s.team);
        if (s.others > 0.01 && s.team < 0.5) vis *= ag.id === this.activeEmbodiment ? 1 : 0.35;
      } else {
        vis = s.team;
      }
      ag.model.setOpacity(vis);
      const reveals = ag === this.main ? 1 - s.others * (1 - s.team) : ag.cluster ? Math.max(s.others, s.team) : s.team;
      if (reveals > 0.02) this.knowledge.reveal(p.u, p.v, ag.revealR, fill * reveals);
    }
    for (let k = 0; k < this.knowData.length; k++) this.knowData[k] = this.knowledge.data[k] * 255;
    this.knowTex.needsUpdate = true;

    const [rx, rz] = toXZ(mainPose.u, mainPose.v);
    (U.uRobot.value as THREE.Vector2).set(rx, rz);

    /* candidate trajectories from the main robot */
    const planVis = s.plans * (1 - s.others);
    if (planVis > 0.01) {
      const { candidates, best } = planArcs(
        mainPose,
        this.goal,
        (u, v) => riskAt(this.world, u, v, Math.min(1, this.knowledge.get(u, v) + s.known), PROFILES.ugv),
        { count: 15, length: 0.2 },
      );
      const lift = 0.03;
      candidates.forEach((c, i) => {
        const pts = c.points.map(([u, v]) => {
          const [x, z] = toXZ(u, v);
          return [x, this.groundY(u, v) + lift, z] as [number, number, number];
        });
        if (i === best) {
          this.best.update(pts, 0.016);
        }
        const r = this.ribbons[i];
        r.update(pts, 0.006);
        r.mat.opacity = planVis * (0.12 + 0.4 * (1 - c.maxRisk)) * (i === best ? 0 : 1);
        r.mat.color.setRGB(0.92, 0.9 - c.maxRisk * 0.35, 0.87 - c.maxRisk * 0.6);
      });
      this.best.mat.opacity = planVis;
    } else {
      this.ribbons.forEach((r) => (r.mat.opacity = 0));
      this.best.mat.opacity = 0;
    }

    /* executed trail */
    const trailVis = s.belief * (1 - s.others) * 0.5;
    if (trailVis > 0.01) {
      const idx = this.mainPhase * (this.mainPath.length - 1);
      const pts: [number, number, number][] = [];
      for (let i = 0; i < 80; i++) {
        const j = Math.max(0, Math.floor(idx) - (79 - i) * 1);
        const p = this.mainPath[j];
        const [x, z] = toXZ(p.u, p.v);
        pts.push([x, this.groundY(p.u, p.v) + 0.02, z]);
      }
      this.trail.update(pts, 0.004);
    }
    this.trail.mat.opacity = trailVis;

    /* orchestration links */
    const teamAgents = this.agents.filter((a) => a.model.group.visible && a !== this.main ? s.team > 0.01 : a === this.main);
    const [ox, oz] = toXZ(this.operatorUV.u, this.operatorUV.v);
    const oy = this.groundY(this.operatorUV.u, this.operatorUV.v);
    this.operator.position.set(ox, oy, oz);
    this.operator.visible = s.team > 0.01;
    this.operator.children.forEach((c) => (((c as THREE.Line).material as THREE.LineBasicMaterial).opacity = s.team));
    this.operator.children[0].rotation.y = t * 0.6;
    let li = 0;
    let pi2 = 0;
    const opTop = new THREE.Vector3(ox, oy + 0.9, oz);
    teamAgents.forEach((ag, i) => {
      const gp = ag.model.group.position;
      if (li + 6 <= this.linkPos.length) {
        this.linkPos.set([opTop.x, opTop.y, opTop.z, gp.x, gp.y + 0.08, gp.z], li);
        li += 6;
      }
      const ph = (t * 0.35 + i * 0.27) % 1;
      const up = i % 2 === 0;
      const q = up ? 1 - ph : ph;
      if (pi2 + 3 <= this.pulsePos.length) {
        this.pulsePos.set(
          [opTop.x + (gp.x - opTop.x) * q, opTop.y + (gp.y + 0.08 - opTop.y) * q, opTop.z + (gp.z - opTop.z) * q],
          pi2,
        );
        pi2 += 3;
      }
    });
    this.linkPos.fill(0, li);
    this.pulsePos.fill(0, pi2);
    this.links.geometry.setDrawRange(0, li / 3);
    this.pulses.geometry.setDrawRange(0, pi2 / 3);
    (this.links.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pulses.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.links.material as THREE.LineBasicMaterial).opacity = s.team * 0.35;
    (this.pulses.material as THREE.PointsMaterial).opacity = s.team;

    /* comms link */
    const cm = this.comm.material as THREE.LineBasicMaterial;
    cm.opacity = s.comm * 0.85;
    (this.commPulses.material as THREE.PointsMaterial).opacity = s.comm;
    if (s.comm > 0.01) {
      const gp = this.main.model.group.position;
      const [hx, hz] = toXZ(A_HUB.u, A_HUB.v);
      const a = new THREE.Vector3(gp.x, gp.y + 0.12, gp.z);
      const b = new THREE.Vector3(hx, this.groundY(A_HUB.u, A_HUB.v) + 0.1, hz);
      const c = a.clone().lerp(b, 0.35);
      c.y = Math.max(a.y, b.y) + 1.4;
      const grow = Math.min(1, s.comm * 1.2);
      const q = new THREE.QuadraticBezierCurve3(a, c, b);
      const n = this.commPos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = q.getPoint((i / (n - 1)) * grow);
        this.commPos.set([p.x, p.y, p.z], i * 3);
      }
      const m = this.commPulsePos.length / 3;
      for (let i = 0; i < m; i++) {
        const p = q.getPoint((((t * 0.3 + i / m) % 1) * grow));
        this.commPulsePos.set([p.x, p.y, p.z], i * 3);
      }
      (this.comm.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.commPulses.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    /* camera */
    const robotP = this.main.model.group.position;
    const cc = this.clusterCenter;
    const [cx, cz] = toXZ(cc.u * (1 - s.team) + 0.5 * s.team, cc.v * (1 - s.team) + 0.5 * s.team);
    const focus = new THREE.Vector3(cx, this.groundY(cc.u, cc.v) * (1 - s.team), cz);
    const target = new THREE.Vector3().copy(robotP).lerp(focus, s.focus);
    this.camTarget.lerp(target, this.camTarget.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 3));
    const az = s.azim + t * 0.015 * (1 - s.bev);
    const ce = Math.cos(s.elev);
    this.camera.position.set(
      this.camTarget.x + Math.cos(az) * ce * s.dist,
      this.camTarget.y + Math.sin(s.elev) * s.dist,
      this.camTarget.z + Math.sin(az) * ce * s.dist,
    );
    this.camera.lookAt(this.camTarget);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
