# @mortal-doctrine/simulation

**Layer:** `simulation` · **May depend on:** `foundation`-layer packages (`sim-core`), `zod`.

The authoritative, deterministic, headless game simulation and the composition package: it owns
`SimulationState`, the fixed 60 Hz `step` function, versioned serialization, and a fixed-step
runner for hosts. Shared contracts (time, numeric helpers, `InputFrame`, RNG, event envelope)
come from `@mortal-doctrine/sim-core` and are imported from there, not re-exported here. Also
the reference package for workspace conventions.

**Non-goals:** rendering, input devices, audio, clocks, React, browser or Node APIs, replay
recording, registration or subscription mechanisms. Hosts supply elapsed time and inputs;
presentation reads state and events and never writes them.

## State and phases

`SimulationState` is `{ frame, rng, input, fighters }`. Every number is an int32; positions are
in sub-units (`SUBUNITS_PER_UNIT = 100` per world unit).

| Slice      | Owner             | Contents                                                                                   |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `rng`      | `src/rng.ts`      | `{ state }` seeded from options; no gameplay draws yet, so `step` leaves it unchanged      |
| `input`    | `src/input.ts`    | `{ capacity, history: [p1Frames, p2Frames] }`, raw frames oldest first, FIFO at `capacity` |
| `fighters` | `src/fighters.ts` | `[{ x }, { x }]`, placeholder walking and arena bounds                                     |

Each owner exports its Zod schema, initial value and a pure
`(slice, readonlyContext) → { slice, events }` update. `step` calls them in a fixed, explicit
order and then increments `frame`:

1. **Input history** — append this tick's raw frames.
2. **Walk/bounds** — move each fighter by `resolveDirection` of its current frame (read from the
   history) and clamp to the arena, emitting `boundary-contact`.
3. **Collect events** — concatenate in phase order; within a phase by player index, then emission.

Adding a subsystem means adding one explicit call in `step` and one slice to the schema.

## API

| Export                                                     | Purpose                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createInitialState(options?)`, `InitialStateOptions`      | `{ seed?, historyCapacity? }` (seed in [0, 2³²−1], default 0; capacity in [1, 600], default 60); fighters at x 24000 and 72000                               |
| `step(state, inputs)`, `StepResult`                        | Pure: `{ state, events }` one tick later. Throws (no state) unless `inputs` is exactly two valid `InputFrame`s                                               |
| `SimulationEvent`, `BoundaryContactEvent`                  | `{ type: 'boundary-contact', frame, player: 0 \| 1, side: 'left' \| 'right' }` on the tick x reaches an edge it was not at. Events arrays are new and frozen |
| `serializeState` / `deserializeState`, `SCHEMA_VERSION`    | JSON `{ schemaVersion: 1, state }`; deserialization throws naming the found/supported version or the failing path, never returning partial state             |
| `simulationStateSchema`, `SimulationState`, `FighterState` | Zod schema and types                                                                                                                                         |
| `createSimulationRunner(options?)`                         | Fixed-step driver: `advance(elapsedMs, provider) → { ticks, events }`, `stepOnce(provider) → events`, `pause`, `resume`, `reset`                             |
| `InputProvider`, `AdvanceResult`, `SimulationRunner`       | `InputProvider` is `(frame) => FrameInputs`, called once per tick with the frame about to be processed                                                       |
| `DEFAULT_HISTORY_CAPACITY`, `MAX_HISTORY_CAPACITY`         | `60`, `600`                                                                                                                                                  |
| `ARENA_WIDTH`, `FIGHTER_WIDTH`, `WALK_SPEED`               | `96000`, `6000` sub-units; `400` sub-units per frame                                                                                                         |

Runner: paused `advance` returns `{ ticks: 0, events: [] }` without calling the provider;
catch-up is capped at 250 ms; `stepOnce` runs one tick regardless of pause; `reset()` rebuilds
`createInitialState(options)` and keeps the pause flag.

`@mortal-doctrine/simulation/testing` exports fixtures for tests, benchmarks and labs: `held`
(ORs `InputBit`s into a frame), `IDLE`, `P1_RIGHT`, `P1_LEFT`, `SEEDED_OPTIONS` (non-default
seed and capacity 8), `walkCycleScript` (an `InputProvider` that produces boundary contacts and
opposing directions) and `runFrames(state, script, count) → { state, events }`.

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
int32 state, input history, event order and immutability, determinism (3,600 frames, mid-run
restore, no input mutation), serialization rejection and the runner.
