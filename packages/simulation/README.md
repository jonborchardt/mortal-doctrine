# @mortal-doctrine/simulation

**Layer:** `simulation` · **May depend on:** `foundation`-layer packages (`sim-core`),
simulation-layer subsystem packages (`commands`, `movement`), `zod`.

The authoritative, deterministic, headless game simulation and the composition package: it owns
`SimulationState`, the fixed 60 Hz `step` function, versioned serialization, and a fixed-step
runner for hosts. Shared contracts (time, numeric helpers, `InputFrame`, RNG, event envelope)
come from `@mortal-doctrine/sim-core` and are imported from there, not re-exported here. Also
the reference package for workspace conventions.

**Non-goals:** rendering, input devices, audio, clocks, React, browser or Node APIs, replay
recording, registration or subscription mechanisms. Hosts supply elapsed time and inputs;
presentation reads state and events and never writes them.

## State and phases

`SimulationState` is `{ frame, rng, input, arena, fighters, commands }`. Every number is an
int32; positions are in sub-units (`SUBUNITS_PER_UNIT = 100` per world unit).

| Slice      | Owner                       | Contents                                                                                   |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `rng`      | `src/rng.ts`                | `{ state }` seeded from options; no gameplay draws yet, so `step` leaves it unchanged      |
| `input`    | `src/input.ts`              | `{ capacity, history: [p1Frames, p2Frames] }`, raw frames oldest first, FIFO at `capacity` |
| `arena`    | `@mortal-doctrine/movement` | `{ width, maxSeparation? }` arena rules from options; read-only during a run               |
| `fighters` | `@mortal-doctrine/movement` | Two `{ x, y, vx, vy, grounded, crouching, facing, params }`: kinematics and pushboxes      |
| `commands` | `@mortal-doctrine/commands` | `{ definitions, charges }`: the command list and per-player charge counters                |

Each owner exports its Zod schema, initial value and a pure
`(slice, readonlyContext) → { slice, events }` update. `step` calls them in a fixed, explicit
order and then increments `frame`:

1. **Input history** — append this tick's raw frames.
2. **Commands** — recognize the definitions from the history with the stored start-of-tick
   facing (`playerFacing`), emitting `command` in player, then definition order.
3. **Movement** — `updateMovement` (walk, crouch, jump, gravity, landing, walls, max separation,
   pushbox separation, facing; rules in the `movement` README), emitting `jump`, `land` and
   `wall-contact` per player in that order.
4. **Collect events** — concatenate in phase order; within a phase by player index, then emission.

Adding a subsystem means adding one explicit call in `step` and one slice to the schema.

## API

| Export                                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createInitialState(options?)`, `InitialStateOptions`      | `{ seed?, historyCapacity?, commands?, movement?, arena? }` (commands: definitions for both players, default none; throws naming the path or when one needs more history than the capacity) (seed in [0, 2³²−1], default 0; capacity in [1, 600], default 60); `movement`: `[p0, p1]` movement parameters, default `DEFAULT_MOVEMENT_PARAMETERS`; `arena`: rules, default width 96000. Throws naming the failing path for invalid parameters or rules, an arena narrower than both fighters' widest pushboxes, or a `maxSeparation` not above their half-widths. Fighters stand at x 24000 and 72000 by default |
| `step(state, inputs)`, `StepResult`                        | Pure: `{ state, events }` one tick later. Throws (no state) unless `inputs` is exactly two valid `InputFrame`s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `playerFacing(state)`                                      | `['right' \| 'left', …]`: each fighter's stored `facing`, which the next `step` uses for command recognition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SimulationEvent`                                          | `CommandEvent` (`@mortal-doctrine/commands`) or `MovementEvent` (`@mortal-doctrine/movement`: `jump`, `land`, `wall-contact` with `side`). Events arrays are new and frozen                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `serializeState` / `deserializeState`, `SCHEMA_VERSION`    | JSON `{ schemaVersion: 1, state }`; deserialization throws naming the found/supported version or the failing path, never returning partial state                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `simulationStateSchema`, `SimulationState`, `FighterState` | Zod schema and types (`FighterState` is re-exported from `movement`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `createSimulationRunner(options?)`                         | Fixed-step driver: `advance(elapsedMs, provider) → { ticks, events }`, `stepOnce(provider) → events`, `alpha`, `pause`, `resume`, `reset`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `InputProvider`, `AdvanceResult`, `SimulationRunner`       | `InputProvider` is `(frame) => FrameInputs`, called once per tick with the frame about to be processed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DEFAULT_HISTORY_CAPACITY`, `MAX_HISTORY_CAPACITY`         | `60`, `600`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `FIGHTER_WIDTH`                                            | `6000` sub-units: the default standing pushbox width (derived from `DEFAULT_MOVEMENT_PARAMETERS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Runner: paused `advance` returns `{ ticks: 0, events: [] }` without calling the provider;
catch-up is capped at 250 ms; `stepOnce` runs one tick regardless of pause; `reset()` rebuilds
`createInitialState(options)` and keeps the pause flag. `alpha` is the fraction of a tick
accumulated but not yet run, in [0, 1) (0 initially, while paused and after `reset`); renderers
may use it to interpolate between snapshots. Reading it never affects state.

`@mortal-doctrine/simulation/testing` exports fixtures for tests, benchmarks and labs: `held`
(ORs `InputBit`s into a frame), `IDLE`, `P1_RIGHT`, `P1_LEFT`, `SEEDED_OPTIONS` (non-default
seed and capacity 8), `walkCycleScript` (an `InputProvider`, left/right only, that produces wall
contacts and opposing directions) and `runFrames(state, script, count) → { state, events }`.

## Usage

```ts
import { InputBit } from '@mortal-doctrine/sim-core';
import { createInitialState, serializeState, step } from '@mortal-doctrine/simulation';
import { runFrames, walkCycleScript } from '@mortal-doctrine/simulation/testing';

const { state, events } = step(createInitialState({ seed: 7 }), [InputBit.RIGHT, 0]);
const later = runFrames(createInitialState(), walkCycleScript, 600);
const saved = serializeState(later.state);
```

In a host loop:

```ts
const runner = createSimulationRunner({ seed: 7 });
onDisplayFrame((elapsedMs) => {
  const { events } = runner.advance(elapsedMs, () => [keyboard.read(), NEUTRAL_INPUT]);
  renderer.render(runner.state);
});
```

## Tests

`pnpm --filter @mortal-doctrine/simulation test` · `... bench`. Covers step input validation,
command recognition through `step` (order, facing, restore mid-charge, 600-frame determinism),
int32 state, input history, event order and immutability, determinism (3,600 frames, mid-run
restore, no input mutation), serialization rejection and the runner. `tests/movement.test.ts`
covers movement through `step`: facing, walls and pushboxes on every frame of long runs, named
corner and cross-up cases, max separation, event order, mirror symmetry for both parameter
sets, 3,600-frame determinism with mid-air restore, and option/state validation.
