import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'skeleton',
  name: 'Skeleton Lab',
  description: 'Pick a fixture rig, rotate its bones and switch attachments.',
  route: '/labs/skeleton',
  category: 'Animation',
  component: lazy(() => import('./SkeletonLab').then((m) => ({ default: m.SkeletonLab }))),
};
