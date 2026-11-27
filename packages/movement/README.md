# @mortal-doctrine/movement

**Layer:** `simulation` · **May depend on:** `@mortal-doctrine/sim-core`, `zod` only.

Deterministic fighter movement: walking, crouching, jumping with integer sub-unit kinematics,
facing, gameplay arena bounds, an optional separation limit and pushbox separation. It owns the
`fighters` slice of simulation state (schemas, initial value, pure update, events) and the arena
rules schema; `@mortal-doctrine/simulation` composes it as phase 3 of `step` and stores the rules
in `state.arena`.

**Non-goals:** dashes, runs, air actions, air control or friction; hit/hurt boxes, knockback,
hitstun; bounds from visual arena geometry; camera; rendering. No character-specific values:
parameters are data passed in by the caller.

## State

Per fighter `{ x, y, vx, vy, grounded, crouching, facing, params }`, every number an int32 in
sub-units (`SUBUNITS_PER_UNIT = 100`): origin = bottom centre of the pushbox, +y up, ground
y = 0, velocities per frame; `facing` is `1` (right) or `-1` (left); `params` are the fighter's
movement parameters. `initialMovement(params, arena)` stands both fighters facing each other,
centred, `width / 2` apart (x 24000 and 72000 in the default 96000 arena) or `maxSeparation`
apart if smaller.

**Parameters** (`movementParametersSchema`, all int32 > 0): `walkForwardSpeed`, `walkBackSpeed`,
`walkAcceleration`, `groundFriction` (sub-units/frame²), `jumpVelocity`, `jumpForwardSpeed`,
`jumpBackSpeed`, `gravity`, and `pushboxes.{standing, crouching, airborne}` `{ width, height }`
(widths even). **Arena rules** (`arenaRulesSchema`): `{ width, maxSeparation? }`,
`maxSeparation ≤ width`. Checks that involve both (width ≥ the two widest pushbox widths,
`maxSeparation` above their half-widths) live in `simulation`'s state schema.

## Per-tick rule

`updateMovement(slice, { frame, inputs, arena }) → { slice, events }`, per fighter, velocity
first, then position. `d = resolveDirection(raw frame)`; forward/back are relative to
start-of-tick facing.

1. **Velocity.** Airborne: input ignored, `vx` kept, `vy -= gravity`. Grounded + up (up + down
   resolves to up): jump, `vy = jumpVelocity`, `vx = 0` or `d.x ·` jump forward/back speed, no
   gravity on the jump tick (y on the n-th airborne tick is `n·jumpVelocity − gravity·n(n−1)/2`).
   Grounded + down: crouch, `vx = decelerate(vx, groundFriction)`. Grounded + `d.x ≠ 0`:
   `vx = clamp(vx + d.x·walkAcceleration, −capLeft, capRight)` with the facing side capped at
   `walkForwardSpeed`, the other at `walkBackSpeed`. Grounded, neutral: friction as for crouch.
2. **Position.** `x += vx; y += vy`. Airborne with `y ≤ 0` lands: `y = 0`, `vy = 0`, grounded;
   `vx` is kept and decays from the next tick. Holding up re-jumps on that next tick.
3. **Walls.** The pushbox (airborne / crouching / standing, of the state after 2) is clamped into
   `[0, width]`.
4. **Max separation** (if set). `excess = |x0 − x1| − maxSeparation`; each fighter that moved
   away from the other this tick moves back by `min(away, ceil(excess / 2))`, the one with the
   larger `away` takes any rest (never beyond its own `away`); a fighter with `away = 0` is never
   moved. No event.
5. **Pushboxes.** Rectangles overlap only if they intersect on both axes (touching is not
   overlap), so a jumper whose feet are at or above the opponent's top passes over it. Pushes are
   horizontal: each moves `ceil(overlap / 2)` away from the other; a fighter stopped by a wall
   leaves the rest of the overlap to the other. Left/right is by x, then start-of-tick x, then
   player 0 left (the one non-mirror-symmetric rule).
6. A fighter whose x was corrected by 3 or 4 loses `vx` pointing into that wall / away from the
   opponent. Rule 5 never changes `vx`.
7. **Facing.** Grounded fighters face the opponent by x; on equal x and while airborne facing is
   kept.

**Events** (`MovementEvent`, frozen, `{ type, frame, player }`): `jump` on the take-off tick,
`land` on the landing tick, `wall-contact` (`side: 'left' | 'right'`) on the tick a pushbox edge
is at a wall at the end of the tick and was not at its start, whatever caused it. Order: player
0 before player 1; within a player `jump`, `land`, `wall-contact`.

All arithmetic is integer addition, `decelerate`, halving of even widths and, in rules 4 and 5,
ceiling halving (`Math.ceil(n / 2)`) of the separation excess and the overlap, following the
`sim-core` movement pattern, so there is no rounding drift and mirrored runs are exact mirrors.
The ceiling is the one deliberate exception to truncating division: it makes the two shares cover
an odd excess or overlap in full.

## API

| Export                                                                       | Purpose                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `movementParametersSchema`, `MovementParameters`, `pushboxSchema`, `Pushbox` | Zod schemas and types for the per-fighter parameters                                     |
| `arenaRulesSchema`, `ArenaRules`                                             | `{ width, maxSeparation? }`                                                              |
| `DEFAULT_MOVEMENT_PARAMETERS`, `DEFAULT_ARENA_RULES`                         | Instant walk at 400 (acceleration = friction = 400), standing box 6000 wide; width 96000 |
| `fighterStateSchema`, `FighterState`, `movementSliceSchema`, `MovementSlice` | The fighter and two-fighter slice schemas                                                |
| `initialMovement(params, arena)`                                             | Initial slice (see State)                                                                |
| `updateMovement(slice, context)`, `MovementContext`                          | The pure per-tick update                                                                 |
| `pushboxOf(fighter)`, `widestPushboxWidth(params)`                           | The box in effect for a fighter's state; the widest of its three widths                  |
| `MovementEvent`, `JumpEvent`, `LandEvent`, `WallContactEvent`, `Facing`      | Event and facing types                                                                   |

`@mortal-doctrine/movement/testing` (tests and labs only): `RAMPED_MOVEMENT_PARAMETERS` (ramped
walk, forward ≠ back, wider crouch box, landing that overshoots y = 0), `PARAMETER_SETS`,
`MOVEMENT_SCENARIOS` (named scripts: walk forward/back, crouch, three jumps, corner push,
cross-up, max separation), `mirrorFrame`, `mirrorInputs`, `mirrorFighter`, `mirrorSlice`,
`mirrorEvent`, and `runMovement(slice, arena, inputs, count) → { slices, events }`.

## Usage

```ts
import {
  DEFAULT_ARENA_RULES,
  DEFAULT_MOVEMENT_PARAMETERS,
  initialMovement,
  updateMovement,
} from '@mortal-doctrine/movement';
import { InputBit } from '@mortal-doctrine/sim-core';

const arena = DEFAULT_ARENA_RULES;
const slice = initialMovement([DEFAULT_MOVEMENT_PARAMETERS, DEFAULT_MOVEMENT_PARAMETERS], arena);
const { slice: next, events } = updateMovement(slice, {
  frame: 0,
  inputs: [InputBit.UP, 0],
  arena,
});
// events: [{ type: 'jump', frame: 0, player: 0 }]; next[0].y === 1950
```

Games use it through `createInitialState({ movement, arena })` and `step` in
`@mortal-doctrine/simulation`.

## Tests

`pnpm --filter @mortal-doctrine/movement test`: literal frame tables for walk forward/back,
crouch and neutral/forward/back jumps with both parameter sets, the closed-form apex, a 658-frame
no-drift run, and schema validation. Integration through `step` (facing, bounds, pushboxes,
separation, events, symmetry, determinism, validation) is in
`packages/simulation/tests/movement.test.ts`.
