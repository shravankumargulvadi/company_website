/**
 * Proof media shown near the end of each candidate.
 * To swap in real footage: drop an optimised MP4/WebM in /public/assets/proof/
 * and set `video` (and optionally `poster`). Items without `video` render a
 * procedural placeholder of the given `placeholder` variant.
 */
import type { SimVariant } from '../lib/simView';

export interface ProofItem {
  id: string;
  label: string;
  caption: string;
  video?: string;
  poster?: string;
  placeholder: SimVariant;
}

export const proofItems: ProofItem[] = [
  {
    id: 'planning',
    label: 'Risk-aware planning',
    caption: 'Ground vehicle choosing among candidate trajectories in simulation.',
    placeholder: 'plan',
  },
  {
    id: 'risk',
    label: 'Spatial risk field',
    caption: 'Risk estimated from terrain, hazards and what has not yet been observed.',
    placeholder: 'risk',
  },
  {
    id: 'belief',
    label: 'World belief',
    caption: 'Observed terrain versus unknown space, updated as the vehicle moves.',
    placeholder: 'belief',
  },
];
