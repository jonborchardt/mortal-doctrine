/** Authoritative simulation rate. All gameplay timing is expressed in ticks of this rate. */
export const TICK_RATE = 60;
/** Duration of one tick in milliseconds. Only hosts converting wall time into ticks use it. */
export const TICK_MS = 1000 / TICK_RATE;
