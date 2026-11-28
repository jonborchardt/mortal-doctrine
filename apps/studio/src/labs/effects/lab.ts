import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'effects',
  name: 'Effects Lab',
  description:
    'Fire simulation events into the effects renderable: spawn once per event, clear on restore, lifetimes on display time.',
  route: '/labs/effects',
  category: 'Presentation',
  component: lazy(() => import('./EffectsLab').then((m) => ({ default: m.EffectsLab }))),
};
