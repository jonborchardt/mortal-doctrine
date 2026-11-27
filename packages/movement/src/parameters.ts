import { int32Schema } from '@mortal-doctrine/sim-core';
import { z } from 'zod';

const positive = int32Schema.positive();

/** Origin at the bottom centre; widths are even so half-widths are integers. */
export const pushboxSchema = z
  .object({ width: positive.multipleOf(2, 'must be even'), height: positive })
  .readonly();

/** Per-fighter movement tuning, all int32 sub-units (per frame, per frame²) and > 0. */
export const movementParametersSchema = z
  .object({
    walkForwardSpeed: positive,
    walkBackSpeed: positive,
    /** Sub-units/frame² added while walking. */
    walkAcceleration: positive,
    /** Sub-units/frame² removed (clamped at 0) while grounded and not walking. */
    groundFriction: positive,
    jumpVelocity: positive,
    jumpForwardSpeed: positive,
    jumpBackSpeed: positive,
    /** Sub-units/frame² subtracted from vy every airborne frame after take-off. */
    gravity: positive,
    pushboxes: z
      .object({ standing: pushboxSchema, crouching: pushboxSchema, airborne: pushboxSchema })
      .readonly(),
  })
  .readonly();

/** Gameplay arena bounds: x ∈ [0, width]; optional cap on the fighters' x distance. */
export const arenaRulesSchema = z
  .object({ width: positive, maxSeparation: positive.optional() })
  .superRefine((arena, ctx) => {
    if (arena.maxSeparation !== undefined && arena.maxSeparation > arena.width) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSeparation'],
        message: `must be at most the arena width ${arena.width}`,
      });
    }
  })
  .readonly();

export type Pushbox = z.infer<typeof pushboxSchema>;
export type MovementParameters = z.infer<typeof movementParametersSchema>;
export type ArenaRules = z.infer<typeof arenaRulesSchema>;

/**
 * Instant walk (acceleration = friction = walk speed), the pre-M1.05 feel; the standing pushbox
 * is 6000 wide. Placeholder tuning until characters supply their own.
 */
export const DEFAULT_MOVEMENT_PARAMETERS: MovementParameters = {
  walkForwardSpeed: 400,
  walkBackSpeed: 400,
  walkAcceleration: 400,
  groundFriction: 400,
  jumpVelocity: 1950,
  jumpForwardSpeed: 500,
  jumpBackSpeed: 500,
  gravity: 100,
  pushboxes: {
    standing: { width: 6000, height: 12000 },
    crouching: { width: 6000, height: 7000 },
    airborne: { width: 4000, height: 8000 },
  },
};

export const DEFAULT_ARENA_RULES: ArenaRules = { width: 96_000 };

/** Widest of the three pushbox widths. */
export function widestPushboxWidth(params: MovementParameters): number {
  const { standing, crouching, airborne } = params.pushboxes;
  return Math.max(standing.width, crouching.width, airborne.width);
}
