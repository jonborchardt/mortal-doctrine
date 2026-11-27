import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'input',
  name: 'Input Lab',
  description:
    'Watch keyboard and gamepad capture: raw device state, per-tick frames, latched taps.',
  route: '/labs/input',
  category: 'Simulation',
  component: lazy(() => import('./InputLab').then((m) => ({ default: m.InputLab }))),
};
