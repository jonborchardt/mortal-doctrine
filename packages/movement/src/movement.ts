import {
  assertInt32,
  decelerate,
  divTrunc,
  int32Schema,
  resolveDirection,
  type FrameInputs,
  type InputFrame,
  type SimulationEventEnvelope,
} from '@mortal-doctrine/sim-core';
import { z } from 'zod';
import {
  movementParametersSchema,
  type ArenaRules,
  type MovementParameters,
  type Pushbox,
} from './parameters';

/** `1` faces right, `-1` faces left; forward is toward the facing side. */
export type Facing = 1 | -1;

/** Origin = bottom centre of the pushbox; +y is up and the ground is y = 0. */
export const fighterStateSchema = z
  .object({
    x: int32Schema,
    y: int32Schema.nonnegative(),
    vx: int32Schema,
    vy: int32Schema,
    grounded: z.boolean(),
    crouching: z.boolean(),
    facing: z.union([z.literal(1), z.literal(-1)]),
    params: movementParametersSchema,
  })
  .readonly();

export const movementSliceSchema = z.tuple([fighterStateSchema, fighterStateSchema]).readonly();

export type FighterState = z.infer<typeof fighterStateSchema>;
export type MovementSlice = z.infer<typeof movementSliceSchema>;

export interface JumpEvent extends SimulationEventEnvelope<'jump'> {
  readonly player: 0 | 1;
}
export interface LandEvent extends SimulationEventEnvelope<'land'> {
  readonly player: 0 | 1;
}
/** A pushbox edge is at a wall at the end of the tick and was not at its start. */
export interface WallContactEvent extends SimulationEventEnvelope<'wall-contact'> {
  readonly player: 0 | 1;
  readonly side: 'left' | 'right';
}
export type MovementEvent = JumpEvent | LandEvent | WallContactEvent;

export interface MovementContext {
  readonly frame: number;
  /** This tick's raw frames. */
  readonly inputs: FrameInputs;
  readonly arena: ArenaRules;
}

/**
 * Both fighters standing, facing each other, centred in the arena: `width / 2` apart (24000 and
 * 72000 in the default 96000 arena), or `maxSeparation` apart if that is smaller.
 */
export function initialMovement(
  params: readonly [MovementParameters, MovementParameters],
  arena: ArenaRules,
): MovementSlice {
  const gap = Math.min(divTrunc(arena.width, 2), arena.maxSeparation ?? arena.width);
  const left = divTrunc(arena.width - gap, 2);
  const fighter = (x: number, facing: Facing, p: MovementParameters): FighterState => ({
    x,
    y: 0,
    vx: 0,
    vy: 0,
    grounded: true,
    crouching: false,
    facing,
    params: p,
  });
  return [fighter(left, 1, params[0]), fighter(left + gap, -1, params[1])];
}

/** The pushbox in effect for a fighter's current state. */
export function pushboxOf(fighter: FighterState): Pushbox {
  const { pushboxes } = fighter.params;
  if (!fighter.grounded) return pushboxes.airborne;
  return fighter.crouching ? pushboxes.crouching : pushboxes.standing;
}

type Draft = { -readonly [K in keyof FighterState]: FighterState[K] };

/** Rules 1–2: velocity from input (or gravity), then position and landing. */
function integrate(start: FighterState, input: InputFrame): { f: Draft; jumped: boolean } {
  const p = start.params;
  const d = resolveDirection(input);
  const f: Draft = { ...start };
  let jumped = false;
  if (!f.grounded) {
    f.vy -= p.gravity;
  } else if (d.y === 1) {
    jumped = true;
    f.vy = p.jumpVelocity;
    f.vx = d.x === 0 ? 0 : d.x * (d.x === start.facing ? p.jumpForwardSpeed : p.jumpBackSpeed);
    f.grounded = false;
    f.crouching = false;
  } else if (d.y === -1) {
    f.crouching = true;
    f.vx = decelerate(f.vx, p.groundFriction);
  } else {
    f.crouching = false;
    if (d.x === 0) {
      f.vx = decelerate(f.vx, p.groundFriction);
    } else {
      const forwardIsRight = start.facing === 1;
      const capRight = forwardIsRight ? p.walkForwardSpeed : p.walkBackSpeed;
      const capLeft = forwardIsRight ? p.walkBackSpeed : p.walkForwardSpeed;
      f.vx = Math.max(-capLeft, Math.min(capRight, f.vx + d.x * p.walkAcceleration));
    }
  }
  f.x += f.vx;
  f.y += f.vy;
  if (!f.grounded && f.y <= 0) {
    f.y = 0;
    f.vy = 0;
    f.grounded = true;
  }
  assertInt32(f.y, 'fighter y');
  assertInt32(f.vy, 'fighter vy');
  return { f, jumped };
}

function wallAt(fighter: FighterState, width: number): 'left' | 'right' | null {
  const half = pushboxOf(fighter).width / 2;
  if (fighter.x - half === 0) return 'left';
  if (fighter.x + half === width) return 'right';
  return null;
}

/**
 * Advances both fighters one tick (rules in the package README): input → velocity → position,
 * landing, wall clamp, max separation, pushbox separation, facing. Pure.
 */
export function updateMovement(
  slice: MovementSlice,
  context: MovementContext,
): { readonly slice: MovementSlice; readonly events: readonly MovementEvent[] } {
  const { frame, inputs, arena } = context;
  const { width } = arena;
  const integrated = [integrate(slice[0], inputs[0]), integrate(slice[1], inputs[1])] as const;
  const drafts = [integrated[0].f, integrated[1].f] as const;

  // Rule 3: wall clamp. Rule 6: velocity into the wall that corrected x is dropped.
  for (const f of drafts) {
    const h = pushboxOf(f).width / 2;
    const clamped = Math.min(width - h, Math.max(h, f.x));
    if ((clamped > f.x && f.vx < 0) || (clamped < f.x && f.vx > 0)) f.vx = 0;
    f.x = clamped;
  }

  // Rule 4: max separation, undone only by fighters that moved away this tick.
  if (arena.maxSeparation !== undefined) {
    const l = drafts[0].x <= drafts[1].x ? 0 : 1;
    const r = l === 0 ? 1 : 0;
    const leftward = drafts[l];
    const rightward = drafts[r];
    const excess = rightward.x - leftward.x - arena.maxSeparation;
    if (excess > 0) {
      const awayL = Math.max(0, slice[l].x - leftward.x);
      const awayR = Math.max(0, rightward.x - slice[r].x);
      // Ceiling, not truncation (spec rule 4): two shares cover an odd excess.
      const share = Math.ceil(excess / 2);
      let moveL = Math.min(awayL, share);
      let moveR = Math.min(awayR, share);
      const rest = excess - moveL - moveR;
      if (rest > 0 && awayL > awayR) moveL += Math.min(rest, awayL - moveL);
      if (rest > 0 && awayR > awayL) moveR += Math.min(rest, awayR - moveR);
      leftward.x += moveL;
      rightward.x -= moveR;
      if (moveL > 0 && leftward.vx < 0) leftward.vx = 0;
      if (moveR > 0 && rightward.vx > 0) rightward.vx = 0;
    }
  }

  // Rule 5: overlapping pushboxes are pushed apart horizontally; vx is untouched.
  const [a, b] = drafts;
  const boxA = pushboxOf(a);
  const boxB = pushboxOf(b);
  const overlap = (boxA.width + boxB.width) / 2 - Math.abs(a.x - b.x);
  if (overlap > 0 && a.y < b.y + boxB.height && b.y < a.y + boxA.height) {
    // Left is by x, then start-of-tick x; on a full tie player 0 goes left.
    const aIsRightOfB = a.x !== b.x ? a.x > b.x : slice[0].x > slice[1].x;
    const l = aIsRightOfB ? 1 : 0;
    const r = l === 0 ? 1 : 0;
    const roomL = drafts[l].x - pushboxOf(drafts[l]).width / 2;
    const roomR = width - pushboxOf(drafts[r]).width / 2 - drafts[r].x;
    // Ceiling, not truncation (spec rule 5): two pushes cover an odd overlap.
    const push = Math.ceil(overlap / 2);
    let moveL = Math.min(push, roomL);
    let moveR = Math.min(push, roomR);
    if (moveL < push) moveR = Math.min(overlap - moveL, roomR);
    else if (moveR < push) moveL = Math.min(overlap - moveR, roomL);
    drafts[l].x -= moveL;
    drafts[r].x += moveR;
  }

  // Rule 7: grounded fighters face the opponent; on equal x and while airborne facing is kept.
  for (const [own, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (own.grounded && own.x !== other.x) own.facing = own.x < other.x ? 1 : -1;
  }

  const events: MovementEvent[] = [];
  for (const player of [0, 1] as const) {
    const start = slice[player];
    const end = drafts[player];
    if (integrated[player].jumped) events.push(Object.freeze({ type: 'jump', frame, player }));
    if (!start.grounded && end.grounded)
      events.push(Object.freeze({ type: 'land', frame, player }));
    const side = wallAt(end, width);
    if (side !== null && wallAt(start, width) !== side) {
      events.push(Object.freeze({ type: 'wall-contact', frame, player, side }));
    }
  }
  return { slice: drafts, events };
}
