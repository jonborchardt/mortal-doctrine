import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'simulation',
  name: 'Simulation Lab',
  description: 'Run, pause, single-step and reset the fixed-step simulation; inspect its state.',
  route: '/labs/simulation',
  category: 'Simulation',
  component: lazy(() => import('./SimulationLab').then((m) => ({ default: m.SimulationLab }))),
};
