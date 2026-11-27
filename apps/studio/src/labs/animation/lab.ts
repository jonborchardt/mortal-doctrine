import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'animation',
  name: 'Animation Lab',
  description: 'Play, scrub and step fixture clips on a rig, and blend two clips.',
  route: '/labs/animation',
  category: 'Animation',
  component: lazy(() => import('./AnimationLab').then((m) => ({ default: m.AnimationLab }))),
};
