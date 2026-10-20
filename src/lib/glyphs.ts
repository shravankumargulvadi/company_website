/**
 * Embodiment glyphs as SVG path data, rendered on Canvas via Path2D
 * (3D fallback and bird's-eye force chapter).
 * Placeholder line art — replace with final illustrations later.
 */
import type { EmbodimentId } from './world';

/** Side profiles, viewBox 0 0 120 60, stroke-only. */
export const PROFILE_GLYPHS: Record<EmbodimentId, string> = {
  ugv: [
    'M12 36 L20 24 H84 L98 30 L106 36 Z',
    'M66 24 V14 H80 V24',
    'M73 14 V8',
    'M22 44 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0',
    'M53 44 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0',
    'M84 44 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0',
    'M16 36 V40 M104 36 V40',
  ].join(' '),
  uav: [
    'M18 30 H102',
    'M48 25 H72 V35 H48 Z',
    'M8 22 H32 M88 22 H112',
    'M20 22 V30 M100 22 V30',
    'M56 35 V41 H64 V35',
    'M40 30 L34 42 M80 30 L86 42',
  ].join(' '),
  legged: [
    'M28 20 H88 L96 27 H22 Z',
    'M88 18 H102 V27',
    'M34 27 L28 39 L35 52',
    'M46 27 L52 39 L46 52',
    'M72 27 L66 39 L73 52',
    'M84 27 L90 39 L84 52',
  ].join(' '),
  maritime: [
    'M8 36 H112 L101 47 H20 Z',
    'M48 36 V26 H74 L82 36',
    'M64 26 V12 M58 16 H70',
    'M2 52 H30 M40 52 H80 M90 52 H118',
  ].join(' '),
};

/** Top-down plans centred at (0,0), roughly -12..12, nose toward -y. */
export const PLAN_GLYPHS: Record<EmbodimentId, string> = {
  ugv: 'M-6 -9 H6 V9 H-6 Z M-9 -8 V8 M9 -8 V8 M-3 -9 L0 -13 L3 -9',
  uav: 'M-7 -7 L7 7 M7 -7 L-7 7 M-12 -8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 -8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M-12 8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M-3 -3 H3 V3 H-3 Z',
  legged: 'M-4 -8 H4 V8 H-4 Z M-4 -6 L-10 -9 M4 -6 L10 -9 M-4 6 L-10 9 M4 6 L10 9 M-2 -8 L0 -11 L2 -8',
  maritime: 'M0 -13 L5 -4 V10 H-5 V-4 Z M-2 0 H2 V5 H-2 Z',
};
