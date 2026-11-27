import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'commands',
  name: 'Command Lab',
  description:
    'Play scripted or live input through the simulation and see which commands it recognizes.',
  route: '/labs/commands',
  category: 'Simulation',
  component: lazy(() => import('./CommandLab').then((m) => ({ default: m.CommandLab }))),
};
