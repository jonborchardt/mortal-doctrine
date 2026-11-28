// Public test fixtures (`@mortal-doctrine/effects/testing`). For tests and labs; production code
// must not import this entry point.
import type { SimulationEvent } from '@mortal-doctrine/simulation';
import type { EffectDefinition, EffectMapping } from './definitions';

/** Core placeholder effects: two sprites and one particle burst. */
export const CORE_EFFECTS: readonly EffectDefinition[] = [
  { id: 'core/land-ring', kind: 'sprite', lifetimeMs: 600, colour: 0xf2e6c8, size: 60 },
  { id: 'core/command-flash', kind: 'sprite', lifetimeMs: 400, colour: 0xffd84a, size: 40 },
  {
    id: 'core/dust-burst',
    kind: 'particles',
    lifetimeMs: 900,
    colour: 0xb8a07a,
    size: 10,
    count: 8,
    distance: 70,
  },
];

/** Every current simulation event type. Offsets in sub-units above the fighter's feet. */
export const CORE_MAPPING: EffectMapping = {
  land: { effect: 'core/land-ring' },
  jump: { effect: 'core/dust-burst' },
  'wall-contact': { effect: 'core/dust-burst', offset: { x: 0, y: 7000 } },
  command: { effect: 'core/command-flash', offset: { x: 0, y: 12_000 } },
};

/** One representative event per type, all on frame 10. */
export const FIXTURE_EVENTS = {
  land: { type: 'land', frame: 10, player: 0 },
  jump: { type: 'jump', frame: 10, player: 1 },
  wallContact: { type: 'wall-contact', frame: 10, player: 1, side: 'right' },
  command: { type: 'command', frame: 10, player: 0, command: 'quarter-circle' },
} as const satisfies Record<string, SimulationEvent>;

/** Two identical same-frame events: two distinct identities, so two effects. */
export const TWIN_LAND_EVENTS: readonly SimulationEvent[] = [
  FIXTURE_EVENTS.land,
  FIXTURE_EVENTS.land,
];
