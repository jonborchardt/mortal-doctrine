import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'arena',
  name: 'Arena Lab',
  description:
    'Pan the camera across the placeholder arena: layered parallax, ground line and per-layer visibility.',
  route: '/labs/arena',
  category: 'Presentation',
  component: lazy(() => import('./ArenaLab').then((m) => ({ default: m.ArenaLab }))),
};
