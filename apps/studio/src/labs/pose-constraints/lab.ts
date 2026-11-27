import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'pose-constraints',
  name: 'Pose Constraints Lab',
  description: 'Drag an IK and aim target on a rig, with angle limits and a mix weight.',
  route: '/labs/pose-constraints',
  category: 'Animation',
  component: lazy(() =>
    import('./PoseConstraintsLab').then((m) => ({ default: m.PoseConstraintsLab })),
  ),
};
