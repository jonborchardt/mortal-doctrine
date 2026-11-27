import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'camera',
  name: 'Camera Lab',
  description:
    'Step scripted fighter movement through the camera: framing, zoom limits, visual bounds and event-driven shake.',
  route: '/labs/camera',
  category: 'Presentation',
  component: lazy(() => import('./CameraLab').then((m) => ({ default: m.CameraLab }))),
};
