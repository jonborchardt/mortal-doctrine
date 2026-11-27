import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'replay',
  name: 'Replay Lab',
  description: 'Record live input, then play, pause, step, seek, export and import the replay.',
  route: '/labs/replay',
  category: 'Analysis',
  component: lazy(() => import('./ReplayLab').then((m) => ({ default: m.ReplayLab }))),
};
