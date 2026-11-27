import { lazy } from 'react';
import type { LabDefinition } from '../../lab-registry';

export const lab: LabDefinition = {
  id: 'audio',
  name: 'Audio Lab',
  description:
    'Fire simulation events into the audio player: cues, dedupe under re-simulation, bus volume and mute.',
  route: '/labs/audio',
  category: 'Presentation',
  component: lazy(() => import('./AudioLab').then((m) => ({ default: m.AudioLab }))),
};
