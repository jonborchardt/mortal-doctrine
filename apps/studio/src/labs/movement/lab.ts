import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'movement',
  name: 'Movement Lab',
  description:
    'Step scripted walks, crouches, jumps, corner pushes and cross-ups; see pushboxes and trajectories.',
  route: '/labs/movement',
  category: 'Simulation',
  component: lazy(() => import('./MovementLab').then((m) => ({ default: m.MovementLab }))),
};
