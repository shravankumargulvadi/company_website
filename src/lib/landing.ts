/** Deterministic illustrative landing assessment, shared by the scene and its UI. */
export interface LandingPoint { x: number; y: number; z: number }
export interface LandingRoute {
  id: string;
  name: string;
  reason: string;
  points: LandingPoint[];
  score: number;
  slope: number;
  roughness: number;
  clearance: number;
  touchdown: LandingPoint;
}
export interface LandingRollout {
  points: LandingPoint[];
  cost: number;
  weight: number;
  corridor: string;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const blend = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const bump = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) =>
  Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

export function landingHeight(x: number, z: number): number {
  const rolling = 1.2 + 1.1 * Math.sin(x * 0.065 + z * 0.025) + 0.65 * Math.cos(z * 0.11);
  const ridge = 15 * bump(x, z, -26, -6, 12, 18);
  const rough = 2.1 * bump(x, z, 0, -33, 12, 24) * (1 + Math.sin(x * 1.1) * Math.cos(z * 0.9));
  const clearing = bump(x, z, 28, -32, 10, 28);
  return (rolling + ridge + rough) * (1 - clearing * 0.97) + clearing * 0.65;
}

export function landingSurface(x: number, z: number) {
  const h = landingHeight(x, z);
  const dx = (landingHeight(x + 0.5, z) - landingHeight(x - 0.5, z));
  const dz = (landingHeight(x, z + 0.5) - landingHeight(x, z - 0.5));
  const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  const roughness = Math.abs(landingHeight(x + 1, z) + landingHeight(x - 1, z) - 2 * h)
    + Math.abs(landingHeight(x, z + 1) + landingHeight(x, z - 1) - 2 * h);
  return { slope, roughness, risk: clamp(slope / 28 * 0.6 + roughness / 1.8 * 0.4) };
}

export function createLandingAssessment() {
  const sites = [
    { id: 'ridge', name: 'A · Ridge approach', x: -28, reason: 'Ridge · limited clearance' },
    { id: 'rough', name: 'B · Direct approach', x: 0, reason: 'Uneven touchdown surface' },
    { id: 'clearing', name: 'C · Offset approach', x: 28, reason: 'Level clearing · clear approach' },
  ];
  const routes: LandingRoute[] = sites.map(site => {
    const touchdown = { x: site.x, y: landingHeight(site.x, -32) + 1.15, z: -32 };
    const points = Array.from({ length: 121 }, (_, i) => {
      const t = i / 120;
      return {
        x: site.x * blend(t / 0.72),
        y: touchdown.y + (29 - touchdown.y) * (1 - t) ** 1.55,
        z: 72 - 104 * t,
      };
    });
    let slope = 0, roughness = 0, clearance = Infinity;
    for (let z = -45; z <= -23; z += 1) for (const dx of [-2, 0, 2]) {
      const surface = landingSurface(site.x + dx, z);
      slope = Math.max(slope, surface.slope);
      roughness = Math.max(roughness, surface.roughness);
    }
    points.slice(0, 101).forEach(p => { clearance = Math.min(clearance, p.y - landingHeight(p.x, p.z)); });
    const score = Math.round(100 * clamp(0.5 * slope / 25 + 0.3 * roughness / 1.8 + 0.2 * (1 - clamp(clearance / 8))));
    return { ...site, touchdown, points, score, slope, roughness, clearance };
  });
  const best = routes.reduce((a, b) => a.score <= b.score ? a : b);
  return { routes, best };
}

export function landingState(progress: number) {
  return {
    scan: blend((progress - 0.04) / 0.25),
    compare: blend((progress - 0.22) / 0.12),
    decided: blend((progress - 0.46) / 0.1),
    flight: clamp((progress - 0.57) / 0.34),
    rollout: blend((progress - 0.91) / 0.07),
  };
}

export function landingPose(route: LandingRoute, progress: number): LandingPoint {
  const { flight, rollout } = landingState(progress);
  const index = flight * (route.points.length - 1);
  const a = route.points[Math.floor(index)];
  const b = route.points[Math.min(route.points.length - 1, Math.floor(index) + 1)];
  const t = index % 1;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t - 12 * rollout;
  return { x, y: rollout > 0 ? landingHeight(x, z) + 1.15 : a.y + (b.y - a.y) * t, z };
}

/** MPPI-style display: perturb smooth approaches, score terrain/control cost,
 * then apply exponential importance weights. Illustrative, not a flight controller.
 * Every horizon starts at the current aircraft pose and shrinks toward touchdown.
 */
export function sampleLandingTrajectories(
  assessment: ReturnType<typeof createLandingAssessment>, progress: number, count = 96, seed = 0,
) {
  const state = landingState(progress);
  const origin = landingPose(assessment.best, progress);
  if (state.flight >= 1) return { rollouts: [], mean: [], minimum: 0, effective: 0 };
  let randomState = (0x6d2b79f5 ^ Math.imul(seed + 1, 1597334677)) >>> 0;
  const random = () => {
    randomState = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    randomState ^= randomState + Math.imul(randomState ^ (randomState >>> 7), randomState | 61);
    return ((randomState ^ (randomState >>> 14)) >>> 0) / 4294967296;
  };
  const rollouts: LandingRollout[] = Array.from({ length: count }, (_, i) => {
    // Convergence concentrates samples around the accepted corridor while retaining alternatives.
    const route = state.decided > 0.5 && i % 5 !== 0
      ? assessment.best : assessment.routes[i % assessment.routes.length];
    const remaining = 1 - state.flight;
    const endpointX = route.touchdown.x + (random() - 0.5) * (route === assessment.best ? 9 : 14) * remaining;
    const bend = (random() - 0.5) * 22 * remaining;
    const altitude = (random() - 0.5) * 8 * remaining;
    const touchdownY = landingHeight(endpointX, -32) + 1.15;
    const points = Array.from({ length: 41 }, (_, j) => {
      const t = j / 40;
      const ease = blend(t / 0.8);
      return {
        x: origin.x + (endpointX - origin.x) * ease + bend * Math.sin(t * Math.PI) ** 2,
        y: touchdownY + (origin.y - touchdownY) * (1 - t) ** 1.55 + altitude * Math.sin(t * Math.PI) ** 2,
        z: origin.z + (-32 - origin.z) * t,
      };
    });
    let collision = 0, proximity = 0, curvature = 0;
    points.forEach((p, j) => {
      const agl = p.y - landingHeight(p.x, p.z);
      collision += Math.max(0, 1.1 - agl) ** 2;
      if (j < 33) proximity += Math.max(0, 4 - agl) * 0.1;
      if (j > 1) {
        const a = points[j - 2], b = points[j - 1];
        curvature += (p.x - 2 * b.x + a.x) ** 2 + (p.y - 2 * b.y + a.y) ** 2;
      }
    });
    const surface = landingSurface(endpointX, -32);
    const cost = route.score * 0.4 + surface.risk * 25 + collision * 15 + proximity + curvature * 3;
    return { points, cost, weight: 0, corridor: route.id };
  });
  const minimum = Math.min(...rollouts.map(r => r.cost));
  const temperature = 7 - state.decided * 3;
  let total = 0;
  rollouts.forEach(r => { r.weight = Math.exp(-(r.cost - minimum) / temperature); total += r.weight; });
  rollouts.forEach(r => { r.weight /= total; });
  const mean: LandingPoint[] = rollouts[0].points.map((_, j) => rollouts.reduce((p, r) => ({
    x: p.x + r.points[j].x * r.weight,
    y: p.y + r.points[j].y * r.weight,
    z: p.z + r.points[j].z * r.weight,
  }), { x: 0, y: 0, z: 0 }));
  return { rollouts, mean, minimum, effective: 1 / rollouts.reduce((sum, r) => sum + r.weight ** 2, 0) };
}
