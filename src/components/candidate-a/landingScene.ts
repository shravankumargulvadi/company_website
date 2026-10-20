/** Pilot assistance: gear-mounted low-light camera and sampled trajectory assessment. */
import * as THREE from 'three';
import { createLandingAssessment, landingHeight, landingSurface, landingPose, landingState, sampleLandingTrajectories } from '../../lib/landing';
import { createNoise2D, fbm, mulberry32 } from '../../lib/noise';

const COLORS = [0xff775a, 0xffbd64, 0xa8e6ff];
const vector = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

export class LandingScene {
  readonly assessment = createLandingAssessment();
  private renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private map = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(76, 1, 0.05, 180);
  private mapCamera = new THREE.PerspectiveCamera(37, 1, 1, 600);
  private aircraft = new THREE.Group();
  private marker = new THREE.Group();
  private lines: { line: THREE.Line; index: number; map: boolean }[] = [];
  private zones: { mesh: THREE.LineLoop; index: number }[] = [];
  private riskMaterial: THREE.ShaderMaterial;
  private cloudGeometry = new THREE.BufferGeometry();
  private cloudMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  private guidanceGeometry = new THREE.BufferGeometry();
  private guidanceMaterial = new THREE.LineBasicMaterial({ color: 0xc9e4d8, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  private sensor = new THREE.Scene();
  private sensorCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sensorMaterial: THREE.ShaderMaterial;
  private elapsed = 0;
  private sampleEpoch = -1;
  private sampleProgress = -1;
  private reduced: boolean;
  private lowPower: boolean;
  private w = 1;
  private h = 1;
  private vertical = false;

  constructor(private canvas: HTMLCanvasElement, opts: { lowPower?: boolean; reducedMotion?: boolean } = {}) {
    this.reduced = opts.reducedMotion ?? false;
    this.lowPower = opts.lowPower ?? false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const segments = opts.lowPower ? 128 : 224;
    const geometry = new THREE.PlaneGeometry(120, 180, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 10);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const risk = new Float32Array(positions.count);
    const noise = createNoise2D(83);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const y = landingHeight(x, z);
      positions.setY(i, y);
      risk[i] = landingSurface(x, z).risk;
      const surface = landingSurface(x, z);
      const tint = 0.55 + fbm(noise, x * 0.12, z * 0.12, 4) * 0.22;
      const stone = Math.min(1, surface.slope / 38);
      colors.set([tint * (0.78 + stone * 0.15), tint * (0.79 + stone * 0.11), tint * (0.7 + stone * 0.13)], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aRisk', new THREE.BufferAttribute(risk, 1));
    geometry.computeVertexNormals();
    const sky = new THREE.Color(0x0b1118);
    this.world.background = sky;
    this.world.fog = new THREE.FogExp2(sky, 0.028);
    const { colorMap, surfaceMap } = this.terrainTextures();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, map: colorMap, bumpMap: surfaceMap, bumpScale: 0.16,
      roughnessMap: surfaceMap, roughness: 0.98, metalness: 0.02,
    }));
    terrain.receiveShadow = true;
    this.world.add(terrain);
    this.world.add(new THREE.HemisphereLight(0x6d829c, 0x29271f, 0.42));
    const moon = new THREE.DirectionalLight(0x8198b6, 0.6);
    moon.position.set(-60, 40, -30);
    this.world.add(moon);
    this.map.background = new THREE.Color(0x050708);
    this.riskMaterial = new THREE.ShaderMaterial({
      uniforms: { uScan: { value: 0 } },
      vertexShader: `
        attribute float aRisk;
        varying float vRisk;
        varying vec3 vPos;
        void main() {
          vRisk = aRisk; vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uScan;
        varying float vRisk;
        varying vec3 vPos;
        void main() {
          float seen = smoothstep(0.0, 9.0, vPos.z - mix(104.0, -86.0, uScan));
          vec3 low = vec3(0.07, 0.17, 0.17);
          vec3 mid = vec3(0.43, 0.29, 0.13);
          vec3 high = vec3(0.63, 0.18, 0.12);
          vec3 col = vRisk < 0.5 ? mix(low, mid, vRisk * 2.0) : mix(mid, high, (vRisk - 0.5) * 2.0);
          float contour = 1.0 - smoothstep(0.02, 0.09, abs(fract(vPos.y * 0.65) - 0.5));
          col += contour * 0.09;
          float hatch = step(0.8, fract((vPos.x + vPos.z) * 0.3));
          gl_FragColor = vec4(mix(vec3(0.035 + hatch * 0.04), col, seen), 1.0);
        }
      `,
    });
    this.map.add(new THREE.Mesh(geometry, this.riskMaterial));
    this.sensorMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uAspect; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float vignette = smoothstep(0.18, 0.78, length(p));
          float grain = hash(vUv * 1200.0 + floor(uTime * 24.0));
          float line = sin(vUv.y * 1700.0) * 0.005;
          float alpha = vignette * 0.4 + grain * 0.055 + line;
          gl_FragColor = vec4(vec3(grain * 0.08), alpha);
        }
      `,
    });
    this.sensor.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sensorMaterial));

    this.buildAircraft();
    this.world.add(this.aircraft);
    const landingLight = new THREE.SpotLight(0xd9ddcb, 180, 78, 0.7, 0.7, 1);
    landingLight.position.set(0, -0.54, -2.8);
    landingLight.target.position.set(0, -22, -35);
    landingLight.castShadow = !opts.lowPower;
    landingLight.shadow.mapSize.set(1024, 1024);
    landingLight.shadow.camera.near = 0.3;
    landingLight.shadow.camera.far = 85;
    landingLight.shadow.bias = -0.0002;
    landingLight.shadow.normalBias = 0.035;
    this.aircraft.add(landingLight, landingLight.target);
    const arrow = new THREE.ConeGeometry(1.5, 3.8, 3);
    arrow.rotateX(-Math.PI / 2);
    this.marker.add(new THREE.Mesh(arrow, new THREE.MeshBasicMaterial({ color: 0xebe9e2, depthTest: false })));
    this.marker.renderOrder = 8;
    this.map.add(this.marker);
    const cloud = new THREE.LineSegments(this.cloudGeometry, this.cloudMaterial);
    cloud.frustumCulled = false;
    cloud.renderOrder = 3;
    this.map.add(cloud);
    const guidance = new THREE.Line(this.guidanceGeometry, this.guidanceMaterial);
    guidance.frustumCulled = false;
    guidance.renderOrder = 6;
    this.map.add(guidance);

    this.assessment.routes.forEach((route, index) => {
      // Keep assessment graphics on the risk map; the camera remains an optical view.
      for (const [scene, isMap] of [[this.map, true]] as const) {
        const material = new THREE.LineDashedMaterial({
          color: COLORS[index], transparent: true, opacity: 0,
          dashSize: 2, gapSize: 1.2, depthTest: !isMap, depthWrite: false,
        });
        const points = route.points.map(p => vector(p).add(new THREE.Vector3(0, 0.3, 0)));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
        line.computeLineDistances();
        line.renderOrder = 5;
        scene.add(line);
        this.lines.push({ line, index, map: isMap });
        const corners = [[-4, -13], [4, -13], [4, 10], [-4, 10]].map(([dx, dz]) => {
          const x = route.touchdown.x + dx, z = route.touchdown.z + dz;
          return new THREE.Vector3(x, landingHeight(x, z) + 0.3, z);
        });
        const zone = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({
          color: COLORS[index], transparent: true, opacity: 0, depthTest: !isMap,
        }));
        scene.add(zone);
        this.zones.push({ mesh: zone, index });
      }
    });
    this.scatterTerrain();
  }

  private terrainTextures() {
    const size = 256;
    const noise = createNoise2D(117), fine = createNoise2D(239);
    const colors = new Uint8Array(size * size * 4), surface = new Uint8Array(colors.length);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      // Periodic sampling keeps repeated soil tiles free of visible seams.
      const periodic = (frequency: number, n: (x: number, y: number) => number) => {
        const x = u * frequency, z = v * frequency;
        const a = n(x, z) * (1 - u) + n(x - frequency, z) * u;
        const b = n(x, z - frequency) * (1 - u) + n(x - frequency, z - frequency) * u;
        return a * (1 - v) + b * v;
      };
      const soil = periodic(7, noise), grit = periodic(74, fine);
      const gravel = Math.max(0, grit - 0.06) * 65;
      const base = 95 + soil * 45 + grit * 23;
      const k = (j * size + i) * 4;
      colors.set([base + gravel, base * 0.95 + gravel, base * 0.81 + gravel, 255], k);
      const height = Math.max(0, Math.min(255, 182 + grit * 100 + soil * 32));
      surface.set([height, 225 + grit * 25, height, 255], k);
    }
    const colorMap = new THREE.DataTexture(colors, size, size, THREE.RGBAFormat);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    const surfaceMap = new THREE.DataTexture(surface, size, size, THREE.RGBAFormat);
    for (const texture of [colorMap, surfaceMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(12, 18);
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    return { colorMap, surfaceMap };
  }

  private scatterTerrain() {
    const random = mulberry32(729);
    const geometry = new THREE.DodecahedronGeometry(1, 1);
    const vertices = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
      const scale = 0.83 + 0.17 * Math.sin(x * 14 + z * 11 + y * 6);
      vertices.setXYZ(i, x * scale, y * scale * 0.7, z * scale);
    }
    geometry.computeVertexNormals();
    const rocks = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0x565951, roughness: 0.94 }), this.lowPower ? 180 : 420);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.count; i++) {
      let x = (random() - 0.5) * 110, z = (random() - 0.5) * 160 + 8;
      // Leave the assessed landing footprint clear; rough areas carry larger stones.
      if (Math.abs(x - 28) < 8 && z > -55 && z < -12) x -= 24;
      const rough = landingSurface(x, z).roughness;
      const size = 0.08 + random() ** 3 * (rough > 0.2 ? 1 : 0.4);
      dummy.position.set(x, landingHeight(x, z) + size * 0.2, z);
      dummy.rotation.set(random(), random() * Math.PI * 2, random() * 0.4);
      dummy.scale.set(size * (1 + random()), size, size * (0.8 + random()));
      dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.receiveShadow = true; rocks.castShadow = !this.lowPower;
    this.world.add(rocks);
    const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.045, 0.25, 3), new THREE.MeshStandardMaterial({ color: 0x555746, roughness: 1 }), this.lowPower ? 1200 : 3200);
    for (let i = 0; i < grass.count; i++) {
      const x = (random() - 0.5) * 100, z = random() * 140 - 55;
      dummy.position.set(x, landingHeight(x, z) + 0.06, z);
      dummy.rotation.set(random() * 0.5, random() * 6.28, random() * 0.3);
      dummy.scale.set(1, 0.4 + random(), 1);
      dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
    }
    grass.receiveShadow = true;
    this.world.add(grass);
    const dust = new Float32Array(360 * 3);
    for (let i = 0; i < dust.length; i += 3) {
      dust[i] = (random() - 0.5) * 90; dust[i + 1] = 1 + random() * 31; dust[i + 2] = random() * 150 - 60;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    this.world.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      color: 0x9caaa9, size: 0.055, transparent: true, opacity: 0.13, depthWrite: false,
    })));
  }

  private updateRollouts(progress: number) {
    const epoch = this.reduced ? 0 : Math.floor(this.elapsed * 4);
    if (epoch === this.sampleEpoch && Math.abs(progress - this.sampleProgress) < 0.004) return;
    this.sampleEpoch = epoch; this.sampleProgress = progress;
    const { rollouts, mean, minimum } = sampleLandingTrajectories(this.assessment, progress, this.lowPower ? 64 : 128, epoch);
    let guidance = this.guidanceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!guidance || guidance.count !== mean.length) {
      guidance = new THREE.BufferAttribute(new Float32Array(mean.length * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.guidanceGeometry.setAttribute('position', guidance);
    }
    mean.forEach((p, i) => guidance!.setXYZ(i, p.x, p.y + 0.6, p.z));
    guidance.needsUpdate = true;
    this.guidanceGeometry.setDrawRange(0, mean.length);
    const vertices = rollouts.reduce((n, r) => n + (r.points.length - 1) * 2, 0);
    let positions = this.cloudGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let colors = this.cloudGeometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!positions || positions.count !== vertices) {
      positions = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
      colors = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.cloudGeometry.setAttribute('position', positions);
      this.cloudGeometry.setAttribute('color', colors);
    }
    const maxWeight = Math.max(...rollouts.map(r => r.weight), 1e-9);
    const low = new THREE.Color(0x9bd2c6), high = new THREE.Color(0xad573d), color = new THREE.Color();
    let vertex = 0;
    for (const rollout of rollouts) {
      const risk = Math.min(1, (rollout.cost - minimum) / 42);
      color.copy(low).lerp(high, risk).multiplyScalar(0.25 + 0.75 * Math.sqrt(rollout.weight / maxWeight));
      for (let i = 1; i < rollout.points.length; i++) for (const p of [rollout.points[i - 1], rollout.points[i]]) {
        positions.setXYZ(vertex, p.x, p.y + 0.4, p.z);
        colors!.setXYZ(vertex++, color.r, color.g, color.b);
      }
    }
    positions.needsUpdate = true; colors!.needsUpdate = true;
    this.cloudGeometry.setDrawRange(0, vertices);
  }

  private buildAircraft() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x454b4c, roughness: 0.68, metalness: 0.36 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x121719, roughness: 0.85, metalness: 0.08 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x555b56, roughness: 0.7 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.3, 7, 12), skin);
    fuselage.rotation.x = Math.PI / 2;
    this.aircraft.add(fuselage);
    const cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), dark);
    cabin.scale.set(0.58, 0.6, 1.25);
    cabin.position.set(0, 0.45, -1.15);
    this.aircraft.add(cabin);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.16, 1.8), skin);
    wing.position.set(0, 0.55, -0.4);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.1), skin);
    tail.position.z = 2.7;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 1.3), accent);
    fin.position.set(0, 0.75, 2.65);
    this.aircraft.add(wing, tail, fin);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 0.1), dark);
    prop.position.z = -3.6;
    this.aircraft.add(prop);
    for (const [x, z] of [[-1.4, -0.65], [1.4, -0.65], [0, 2.5]]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 6), dark);
      strut.position.set(x, -0.55, z);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 32), dark);
      wheel.name = `landing-gear-${x}`;
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, -0.87, z);
      this.aircraft.add(strut, wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.195, 16), skin);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      this.aircraft.add(hub);
    }
    this.aircraft.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
  }

  resize() {
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.vertical = this.w / this.h < 1;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.vertical ? this.w / (this.h / 2) : this.w / 2 / this.h;
    this.camera.fov = Math.max(76, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 6) / this.camera.aspect)));
    this.mapCamera.aspect = this.camera.aspect;
    // Fit the whole approach in narrow desktop viewports as well as on mobile.
    this.mapCamera.fov = Math.max(this.vertical ? 46 : 37,
      THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(14 * Math.PI / 180) / this.mapCamera.aspect)));
    this.camera.updateProjectionMatrix();
    this.mapCamera.updateProjectionMatrix();
    this.sensorMaterial.uniforms.uAspect.value = this.camera.aspect;
  }

  frame(dt: number, progress: number) {
    this.elapsed += Math.min(0.05, dt);
    const state = landingState(progress);
    const route = this.assessment.best;
    const pose = landingPose(route, progress);
    const index = Math.min(route.points.length - 2, Math.floor(state.flight * (route.points.length - 1)));
    const before = route.points[Math.max(0, index - 1)], ahead = route.points[index + 1];
    const heading = state.flight < 1 ? Math.atan2(ahead.x - before.x, -(ahead.z - before.z)) : 0;
    const pitch = state.flight < 1
      ? Math.atan2(ahead.y - before.y, Math.max(0.01, Math.hypot(ahead.x - before.x, ahead.z - before.z))) : 0;
    this.aircraft.position.copy(vector(pose));
    this.aircraft.rotation.set(pitch, -heading, -Math.sin(state.flight * Math.PI * 2) * 0.12, 'YXZ');
    this.marker.position.set(pose.x, pose.y + 2, pose.z);
    this.marker.rotation.y = -heading;
    this.aircraft.updateMatrixWorld(true);
    this.camera.position.copy(this.aircraft.localToWorld(new THREE.Vector3(0, -0.65, 2.25)));
    this.camera.up.set(0, 1, 0).applyQuaternion(this.aircraft.quaternion);
    this.camera.lookAt(this.aircraft.localToWorld(new THREE.Vector3(0, -14, -28)));
    const distance = this.vertical ? 255 : 285;
    this.mapCamera.position.set(distance * 0.4, distance * 0.77, distance * 0.55 + 10);
    this.mapCamera.lookAt(0, 0, 10);
    this.riskMaterial.uniforms.uScan.value = state.scan;
    this.sensorMaterial.uniforms.uTime.value = this.reduced ? 0 : this.elapsed;
    this.updateRollouts(progress);
    this.cloudMaterial.opacity = state.compare * (1 - THREE.MathUtils.smoothstep(state.flight, 0.91, 1)) * 0.72;
    this.guidanceMaterial.opacity = state.compare * (1 - THREE.MathUtils.smoothstep(state.flight, 0.95, 1)) * 0.9;
    for (const { line, index, map } of this.lines) {
      const best = this.assessment.routes[index] === route;
      const material = line.material as THREE.LineDashedMaterial;
      material.opacity = state.compare * (best ? 0.55 + state.decided * 0.4 : 0.25 - state.decided * 0.12);
      material.gapSize = best ? 1.2 * (1 - state.decided) : 1.2;
      material.depthTest = map ? false : !best;
    }
    for (const { mesh, index } of this.zones) {
      const best = this.assessment.routes[index] === route;
      (mesh.material as THREE.LineBasicMaterial).opacity = state.scan * (best ? 0.5 + state.decided * 0.5 : 0.45 - state.decided * 0.25);
    }
    const { w, h, renderer } = this;
    renderer.setScissorTest(true);
    const views: [THREE.Scene, THREE.Camera, number, number, number, number][] = this.vertical
      ? [[this.world, this.camera, 0, Math.floor(h / 2), w, h - Math.floor(h / 2)], [this.map, this.mapCamera, 0, 0, w, Math.floor(h / 2)]]
      : [[this.world, this.camera, 0, 0, Math.floor(w / 2), h], [this.map, this.mapCamera, Math.floor(w / 2), 0, w - Math.floor(w / 2), h]];
    for (const [scene, camera, x, y, vw, vh] of views) {
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(scene, camera);
      if (scene === this.world) {
        renderer.autoClear = false;
        renderer.render(this.sensor, this.sensorCamera);
        renderer.autoClear = true;
      }
    }
  }
}
