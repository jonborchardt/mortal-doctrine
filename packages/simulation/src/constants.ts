/** Authoritative simulation rate. All gameplay timing is expressed in ticks of this rate. */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

// World units are integers so that stepping is exact and platform-independent.
export const ARENA_WIDTH = 960;
export const FIGHTER_WIDTH = 60;
export const WALK_SPEED = 4;
