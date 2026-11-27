import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';

// Integer sub-units (see sim-core's numeric convention) so stepping is exact everywhere.
export const ARENA_WIDTH = 960 * SUBUNITS_PER_UNIT;
export const FIGHTER_WIDTH = 60 * SUBUNITS_PER_UNIT;
/** Sub-units per frame. */
export const WALK_SPEED = 4 * SUBUNITS_PER_UNIT;
