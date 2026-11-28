import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'integration',
  name: 'Integration Lab',
  description:
    'Every M1 system composed: input, commands, movement, rigs, animation, camera, arena, effects, audio and replay.',
  route: '/labs/integration',
  category: 'Analysis',
  component: lazy(() => import('./IntegrationLab').then((m) => ({ default: m.IntegrationLab }))),
};
