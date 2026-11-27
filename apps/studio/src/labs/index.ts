import { buildLabIndex, type PlannedLab } from '../lab-registry';

// Convention-based discovery: every `labs/<id>/lab.ts` is registered automatically.
const modules = import.meta.glob('./*/lab.ts', { eager: true });

// Roadmap placeholders shown as unavailable. An implemented lab with the same id replaces its
// entry automatically; deleting the line here afterwards is optional tidy-up.
const PLANNED: readonly PlannedLab[] = [
  { id: 'input', name: 'Input Lab', category: 'Simulation' },
  { id: 'movement', name: 'Movement Lab', category: 'Simulation' },
  { id: 'collision', name: 'Collision Lab', category: 'Simulation' },
  { id: 'combat', name: 'Combat Lab', category: 'Simulation' },
  { id: 'combo', name: 'Combo Lab', category: 'Simulation' },
  { id: 'animation', name: 'Animation Lab', category: 'Animation' },
  { id: 'effects', name: 'Effects Lab', category: 'Presentation' },
  { id: 'camera', name: 'Camera Lab', category: 'Presentation' },
  { id: 'arena', name: 'Arena Lab', category: 'Presentation' },
  { id: 'audio', name: 'Audio Lab', category: 'Presentation' },
  { id: 'character', name: 'Character Lab', category: 'Content' },
  { id: 'ai', name: 'AI Lab', category: 'Analysis' },
  { id: 'balance', name: 'Balance Lab', category: 'Analysis' },
  { id: 'replay', name: 'Replay Lab', category: 'Analysis' },
];

export const LAB_INDEX = buildLabIndex(modules, PLANNED);
