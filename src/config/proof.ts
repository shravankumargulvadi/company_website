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
  placeholder: SimVariant | 'passage';
}

export const proofItems: ProofItem[] = [
  {
    id: 'planning',
    label: 'Risk-aware planning',
    caption: 'Ground vehicle choosing among candidate trajectories in simulation.',
    placeholder: 'plan',
  },
  {
    id: 'passage',
    label: 'Risk estimation, confined passage',
    caption: 'Risk map built as a ground vehicle drives an unmapped passage.',
    placeholder: 'passage',
  },
  {
    id: 'belief',
    label: 'World belief',
    caption: 'Observed terrain versus unknown space, updated as the vehicle moves.',
    placeholder: 'belief',
  },
];
