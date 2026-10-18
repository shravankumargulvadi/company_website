/** Shared layout of Candidate A's world, so the 3D scene and the bird's-eye chapter line up. */
import type { WorldOptions } from '../../lib/world';

export const A_WORLD: WorldOptions = { size: 192, seed: 11, waterFraction: 0.1, hazards: true };
/** World size in scene units (u, v in [0, 1] span EXTENT). */
export const A_EXTENT = 10;
/** Where the ground vehicle's mission ends and it stops. */
export const A_GOAL = { u: 0.82, v: 0.24 };
/** Shunya OS node the vehicle's link runs to. */
export const A_HUB = { u: 0.55, v: 0.5 };
/** Camera distance at the top-down handoff into the bird's-eye view. */
export const A_LINK_DIST = 4;
