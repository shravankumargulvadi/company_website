/** Under-canopy scout camera and progressively observed ground-movement map. */
import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32 } from '../../lib/noise';
import {
  createForestRecon, forestHeight, forestRisk, forestState, forestScoutPose,
  forestTeamPose, forestObservationSamples, forestObservedAt, type ForestRecon,
} from '../../lib/forestRecon';

const ROUTE_COLORS = [0xc27653, 0xc9a668, 0xa9d7c4];

export class ForestScene {
  private model: ForestRecon;
  private renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private map = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(66, 1, 0.08, 180);
  private mapCamera = new THREE.PerspectiveCamera(36, 1, 1, 400);
  private quad = new THREE.Group();
  private team = new THREE.Group();
  private mapQuad = new THREE.Group();
  private mapTeam = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private mapTrees: THREE.InstancedMesh;
  private treeSeen: number[];
  private riskMaterial: THREE.ShaderMaterial;
  private routes: THREE.Line[] = [];
  private hazards: { marker: THREE.LineLoop; seen: number }[] = [];
  private scan: THREE.LineLoop;
  private lastSeen = -1;
  private elapsed = 0;
  private w = 1;
  private h = 1;
  private vertical = false;
  private reduced: boolean;
  private heading = 0;
  private oriented = false;

  constructor(private canvas: HTMLCanvasElement, opts: { lowPower?: boolean; reducedMotion?: boolean; model?: ForestRecon } = {}) {
    this.model = opts.model ?? createForestRecon();
    this.reduced = opts.reducedMotion ?? false;
    const { model } = this;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const samples = forestObservationSamples(model);
    this.treeSeen = model.trees.map(t => forestObservedAt(samples, t.x, t.z));
    const noise = createNoise2D(591);
    const terrain = new THREE.PlaneGeometry(76, 108, opts.lowPower ? 64 : 96, opts.lowPower ? 88 : 132);
    terrain.rotateX(-Math.PI / 2); terrain.translate(0, 0, 49);
    const positions = terrain.attributes.position as THREE.BufferAttribute;
    const color = new Float32Array(positions.count * 3), risk = new Float32Array(positions.count), seen = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), height = forestHeight(x, z);
      positions.setY(i, height);
      const shade = 0.37 + fbm(noise, x * 0.27, z * 0.27, 4) * 0.14;
      color.set([shade * 0.8, shade * 0.81, shade * 0.61], i * 3);
      risk[i] = forestRisk(model, x, z);
      seen[i] = forestObservedAt(samples, x, z);
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(color, 3));
    terrain.setAttribute('aRisk', new THREE.BufferAttribute(risk, 1));
    terrain.setAttribute('aSeen', new THREE.BufferAttribute(seen, 1));
    terrain.computeVertexNormals();
    const soil = this.makeTexture('soil');
    soil.repeat.set(13, 18);
    const floor = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({
      vertexColors: true, map: soil, bumpMap: soil, bumpScale: 0.07, roughness: 1,
    }));
    floor.receiveShadow = true;
    this.world.add(floor);
    this.world.background = new THREE.Color(0x0c1719);
    this.world.fog = new THREE.FogExp2(0x0c1719, 0.028);
    this.world.add(new THREE.HemisphereLight(0x9aafba, 0x262b1d, 0.9));
    const sun = new THREE.DirectionalLight(0xc4d2b3, 1.7);
    sun.position.set(-25, 50, -35); this.world.add(sun);
    this.map.background = new THREE.Color(0x060b0d);
    this.riskMaterial = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader: `
        attribute float aRisk; attribute float aSeen;
        varying float vRisk; varying float vSeen; varying vec3 vPos;
        void main() { vRisk=aRisk; vSeen=aSeen; vPos=position;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uProgress; varying float vRisk; varying float vSeen; varying vec3 vPos;
        void main() {
          float known=1.0-smoothstep(uProgress-0.025,uProgress+0.008,vSeen);
          vec3 safe=vec3(0.085,0.19,0.16), hazard=vec3(0.57,0.23,0.13);
          vec3 col=mix(safe,hazard,vRisk);
          float hatch=step(0.83,fract((vPos.x+vPos.z)*0.6));
          vec3 unknown=vec3(0.026,0.042,0.046)+hatch*0.025;
          gl_FragColor=vec4(mix(unknown,col,known),1.0);
        }
      `,
    });
    this.map.add(new THREE.Mesh(terrain, this.riskMaterial));
    this.buildForest();
    this.buildQuad();
    this.buildTeam();
    const light = new THREE.SpotLight(0xd7e1ca, 52, 28, 0.6, 0.7, 1);
    light.position.set(0, 0, -0.3); light.target.position.set(0, -1.7, -15);
    light.castShadow = !opts.lowPower;
    light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.0005;
    this.quad.add(light, light.target);
    this.world.add(this.quad, this.team);
    const mapTrunk = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.mapTrees = new THREE.InstancedMesh(mapTrunk, new THREE.MeshBasicMaterial({ color: 0xffffff }), model.trees.length);
    const dummy = new THREE.Object3D();
    model.trees.forEach((tree, i) => {
      dummy.position.set(tree.x, forestHeight(tree.x, tree.z) + 0.7, tree.z);
      dummy.scale.set(tree.radius * 1.25, 1.4, tree.radius * 1.25); dummy.updateMatrix();
      this.mapTrees.setMatrixAt(i, dummy.matrix); this.mapTrees.setColorAt(i, new THREE.Color(0x10191a));
    });
    this.map.add(this.mapTrees, this.mapQuad, this.mapTeam);
    model.routes.forEach((route, index) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.points.map(p =>
        new THREE.Vector3(p.x, forestHeight(p.x, p.z) + 0.4, p.z))), new THREE.LineDashedMaterial({
        color: ROUTE_COLORS[index], dashSize: 1.1, gapSize: 0.6,
        transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      line.computeLineDistances(); line.renderOrder = 5;
      this.map.add(line); this.routes.push(line);
    });
    model.hazards.forEach(hazard => {
      const points = Array.from({ length: 36 }, (_, i) => {
        const a = i / 36 * Math.PI * 2;
        return new THREE.Vector3(hazard.x + Math.cos(a) * hazard.radius,
          forestHeight(hazard.x, hazard.z) + 0.5, hazard.z + Math.sin(a) * hazard.radius);
      });
      const marker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({
        color: hazard.kind === 'slope' ? 0xc8a366 : 0xcb795b, transparent: true, opacity: 0, depthTest: false,
      }));
      marker.renderOrder = 4; this.map.add(marker);
      this.hazards.push({ marker, seen: forestObservedAt(samples, hazard.x, hazard.z) });
    });
    const ring = Array.from({ length: 72 }, (_, i) => new THREE.Vector3(Math.cos(i / 72 * 6.28) * 17, 0, Math.sin(i / 72 * 6.28) * 17));
    this.scan = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({
      color: 0x84b3a0, transparent: true, opacity: 0.3, depthTest: false,
    }));
    this.map.add(this.scan);
  }

  private makeTexture(kind: 'soil' | 'bark' | 'leaves') {
    const size = 128, data = new Uint8Array(size * size * 4);
    const random = mulberry32(kind === 'leaves' ? 89 : 13);
    const noise = createNoise2D(kind === 'bark' ? 71 : 93);
    if (kind === 'leaves') {
      for (let n = 0; n < 420; n++) {
        const a = random() * Math.PI * 2, radius = Math.sqrt(random()) * 54;
        const cx = 64 + Math.cos(a) * radius, cy = 64 + Math.sin(a) * radius;
        const rx = 2 + random() * 5, ry = 1 + random() * 2, rotation = random() * 6.28;
        for (let y = Math.max(0, Math.floor(cy - rx)); y < Math.min(size, cy + rx); y++) for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(size, cx + rx); x++) {
          const dx = x - cx, dy = y - cy;
          const u = dx * Math.cos(rotation) + dy * Math.sin(rotation), v = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
          if ((u / rx) ** 2 + (v / ry) ** 2 > 1) continue;
          const tint = 0.6 + random() * 0.4;
          data.set([43 * tint, 72 * tint, 36 * tint, 255], (y * size + x) * 4);
        }
      }
    } else for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const grain = kind === 'bark' ? fbm(noise, x * 0.32, y * 0.035, 3) : fbm(noise, x * 0.18, y * 0.18, 3);
      const tint = 87 + grain * 72 + random() * 18;
      data.set([tint, tint * (kind === 'bark' ? 0.88 : 0.93), tint * 0.7, 255], (y * size + x) * 4);
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
    return texture;
  }

  private buildForest() {
    const { trees } = this.model, dummy = new THREE.Object3D();
    const bark = this.makeTexture('bark'); bark.repeat.set(2, 9);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8e9182, map: bark, bumpMap: bark, bumpScale: 0.1, roughness: 1 });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 1, 1, 10), wood, trees.length);
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.12, 1, 6), wood, trees.length * 2);
    const crowns = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
      map: this.makeTexture('leaves'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xb6c9a2,
    }), trees.length * 3);
    trees.forEach((tree, i) => {
      const ground = forestHeight(tree.x, tree.z);
      dummy.position.set(tree.x, ground + tree.height / 2, tree.z);
      dummy.rotation.set(0, i * 1.72, 0); dummy.scale.set(tree.radius, tree.height, tree.radius);
      dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < 2; j++) {
        dummy.position.set(tree.x + Math.sin(i + j * 3) * 0.9, ground + tree.height * (0.55 + j * 0.15), tree.z + Math.cos(i) * 0.7);
        dummy.rotation.set(0.8 + j * 0.3, i * 1.2, 1.1);
        dummy.scale.set(1, 3 + (i % 3), 1); dummy.updateMatrix(); branches.setMatrixAt(i * 2 + j, dummy.matrix);
      }
      for (let j = 0; j < 3; j++) {
        dummy.position.set(tree.x + Math.sin(i + j) * 1.6, ground + tree.height * (0.72 + j * 0.1), tree.z + Math.cos(i + j * 2) * 1.6);
        dummy.rotation.set(-Math.PI / 2 + Math.sin(i + j) * 0.4, i * 1.6, j * 1.3);
        dummy.scale.set(tree.crown * 2.5, tree.crown * 2.5, 1); dummy.updateMatrix(); crowns.setMatrixAt(i * 3 + j, dummy.matrix);
      }
    });
    trunks.castShadow = true; trunks.receiveShadow = true;
    branches.castShadow = true; crowns.receiveShadow = true;
    this.world.add(trunks, branches, crowns);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 8.4, 12), wood);
    log.rotation.z = Math.PI / 2; log.position.set(0, forestHeight(0, 43) + 0.42, 43);
    log.castShadow = true; log.receiveShadow = true; this.world.add(log);
    // Low understory around trunks leaves the assessed corridors physically open.
    const shrubs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.3), new THREE.MeshStandardMaterial({
      map: this.makeTexture('leaves'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0x91a777,
    }), trees.length * 2);
    trees.forEach((tree, i) => { for (let j = 0; j < 2; j++) {
      const x = tree.x + Math.sin(i + j * 2) * 0.7, z = tree.z + Math.cos(i + j) * 0.7;
      dummy.position.set(x, forestHeight(x, z) + 0.55, z); dummy.rotation.set(-0.25, i * 1.3 + j * 1.5, 0);
      dummy.scale.setScalar(0.8 + (i % 4) * 0.2); dummy.updateMatrix(); shrubs.setMatrixAt(i * 2 + j, dummy.matrix);
    } });
    this.world.add(shrubs);
  }

  private buildQuad() {
    const carbon = new THREE.MeshStandardMaterial({ color: 0x282f30, metalness: 0.3, roughness: 0.65 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.4), carbon); this.quad.add(body);
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.57, 8), carbon);
      arm.position.set(x / 2, 0, z / 2); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0, z).normalize());
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 12), carbon); motor.position.set(x, 0.03, z);
      const prop = new THREE.Mesh(new THREE.CircleGeometry(0.23, 24), new THREE.MeshBasicMaterial({ color: 0xb8c2be, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      prop.rotation.x = -Math.PI / 2; prop.position.set(x, 0.09, z); this.rotors.push(prop);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.009, 5, 24), carbon);
      guard.rotation.x = Math.PI / 2; guard.position.set(x, 0.065, z);
      this.quad.add(arm, motor, prop, guard);
      const mapRotor = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.1, 4, 16), new THREE.MeshBasicMaterial({ color: 0xd4e3d8, depthTest: false }));
      mapRotor.rotation.x = Math.PI / 2; mapRotor.position.set(x * 2.8, 0, z * 2.8); this.mapQuad.add(mapRotor);
    }
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0c1518, metalness: 0.5, roughness: 0.2 }));
    lens.position.set(0, -0.03, -0.22); this.quad.add(lens);
    this.quad.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.rotors.forEach(rotor => { rotor.castShadow = false; });
  }

  private buildTeam() {
    const suit = new THREE.MeshStandardMaterial({ color: 0x50594a, roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const person = new THREE.Group(); person.position.set((i - 1) * 0.85, 0, 3 + Math.abs(i - 1) * 1.3);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.65, 8), suit); torso.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), suit); head.position.y = 1.7;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 6), suit); neck.position.y = 1.47;
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.45, 0.18), suit); pack.position.set(0, 1.15, 0.22);
      person.add(torso, head, neck, pack);
      for (const x of [-0.11, 0.11]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.65, 6), suit); leg.position.set(x, 0.38, 0);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), suit); arm.position.set(x * 2.5, 1.08, 0); arm.rotation.z = -Math.sign(x) * 0.18;
        person.add(leg, arm);
      }
      this.team.add(person);
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), new THREE.MeshBasicMaterial({ color: 0xdfdccb, depthTest: false }));
      marker.position.set((i - 1) * 1.3, 0.6, 2 + Math.abs(i - 1) * 1.8); this.mapTeam.add(marker);
    }
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth); this.h = Math.max(1, this.canvas.clientHeight);
    this.vertical = this.w / this.h < 1; this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.camera.fov = Math.max(66, THREE.MathUtils.radToDeg(2 * Math.atan(0.48 / this.camera.aspect)));
    this.mapCamera.aspect = this.camera.aspect;
    this.mapCamera.fov = Math.max(36, THREE.MathUtils.radToDeg(2 * Math.atan(0.27 / this.mapCamera.aspect)));
    this.camera.updateProjectionMatrix(); this.mapCamera.updateProjectionMatrix();
  }

  frame(dt: number, progress: number) {
    this.elapsed += Math.min(dt, 0.05);
    const { model } = this, state = forestState(progress), pose = forestScoutPose(model, progress);
    const a = forestScoutPose(model, Math.max(0.101, Math.min(0.798, progress - 0.002)));
    const b = forestScoutPose(model, Math.max(0.103, Math.min(0.8, progress + 0.002)));
    const targetHeading = Math.hypot(b.x - a.x, b.z - a.z) > 1e-5 ? Math.atan2(b.x - a.x, -(b.z - a.z)) : 0;
    if (!this.oriented) { this.heading = targetHeading; this.oriented = true; }
    const turn = Math.atan2(Math.sin(targetHeading - this.heading), Math.cos(targetHeading - this.heading));
    this.heading += turn * (this.reduced ? 1 : 1 - Math.exp(-dt * 7));
    const heading = this.heading;
    const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
    this.quad.position.set(pose.x, pose.y + (this.reduced ? 0 : Math.sin(this.elapsed * 3) * 0.015), pose.z);
    this.quad.rotation.set(-0.025, -heading, 0, 'YXZ');
    this.mapQuad.position.set(pose.x, forestHeight(pose.x, pose.z) + 2.5, pose.z); this.mapQuad.rotation.y = -heading;
    const team = forestTeamPose(model, progress);
    this.team.position.set(team.x, team.y, team.z); this.mapTeam.position.copy(this.team.position);
    const nextTeam = forestTeamPose(model, Math.min(1, progress + 0.002));
    const teamHeading = Math.hypot(nextTeam.x - team.x, nextTeam.z - team.z) > 1e-5
      ? Math.atan2(nextTeam.x - team.x, -(nextTeam.z - team.z)) : 0;
    this.team.rotation.y = this.mapTeam.rotation.y = -teamHeading;
    const look = new THREE.Vector3(pose.x, pose.y + 0.1, pose.z).addScaledVector(forward, 7);
    this.camera.position.set(pose.x, pose.y + 0.9 + (1 - state.launch) * 1.8, pose.z);
    this.camera.position.addScaledVector(forward, -(3 + (1 - state.launch) * 5));
    this.camera.position.y = Math.max(this.camera.position.y, forestHeight(this.camera.position.x, this.camera.position.z) + 1.8);
    this.camera.lookAt(look);
    this.mapCamera.position.set(58, 141, 130); this.mapCamera.lookAt(0, 0, 49);
    this.riskMaterial.uniforms.uProgress.value = progress;
    this.scan.position.set(pose.x, forestHeight(pose.x, pose.z) + 0.6, pose.z);
    if (Math.floor(progress * 100) !== this.lastSeen) {
      this.lastSeen = Math.floor(progress * 100);
      model.trees.forEach((tree, i) => this.mapTrees.setColorAt(i, new THREE.Color(this.treeSeen[i] <= progress
        ? (Math.abs(tree.x) < 2 && tree.z === 49 ? 0xa46e4e : 0x3c5846) : 0x10191a)));
      this.mapTrees.instanceColor!.needsUpdate = true;
    }
    this.routes.forEach((line, i) => {
      const best = model.routes[i] === model.best, material = line.material as THREE.LineDashedMaterial;
      material.opacity = state.compare * (best ? 0.65 + state.recommended * 0.35 : 0.4 - state.recommended * 0.24);
      material.gapSize = best && state.recommended > 0.5 ? 0 : 0.6;
      line.geometry.setDrawRange(0, best ? Math.floor(25 + (model.best.points.length - 25) * state.scouting) : model.routes[i].points.length);
    });
    this.hazards.forEach(({ marker, seen }) => { (marker.material as THREE.LineBasicMaterial).opacity = progress >= seen ? 0.8 : 0; });
    const { w, h, renderer } = this; renderer.setScissorTest(true);
    const views: [THREE.Scene, THREE.Camera, number, number, number, number][] = this.vertical
      ? [[this.world, this.camera, 0, Math.floor(h / 2), w, h - Math.floor(h / 2)], [this.map, this.mapCamera, 0, 0, w, Math.floor(h / 2)]]
      : [[this.world, this.camera, 0, 0, Math.floor(w / 2), h], [this.map, this.mapCamera, Math.floor(w / 2), 0, w - Math.floor(w / 2), h]];
    for (const [scene, camera, x, y, width, height] of views) {
      renderer.setViewport(x, y, width, height); renderer.setScissor(x, y, width, height); renderer.render(scene, camera);
    }
  }
}
