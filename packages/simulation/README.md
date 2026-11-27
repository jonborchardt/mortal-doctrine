# @mortal-doctrine/simulation

**Layer:** `simulation` · **May depend on:** `foundation`-layer packages, `zod`.

The authoritative, deterministic, headless game simulation: state schema, the fixed 60 Hz `step`
function, serialization, and a fixed-step runner for hosts. Also the reference package for
workspace conventions.

**Non-goals:** rendering, input devices, audio, clocks, React, browser or Node APIs. Hosts supply
elapsed time and inputs; presentation reads state and never writes it.

## API

| Export                                                               | Purpose                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `createInitialState()`                                               | Known starting state (frame 0, fighters at x 240 and 720)                               |
| `step(state, inputs)`                                                | Pure: returns the next state, one tick later                                            |
| `serializeState` / `deserializeState`                                | JSON round trip; deserialization validates with Zod and throws on bad data              |
| `simulationStateSchema`                                              | Zod schema for state                                                                    |
| `createSimulationRunner(initial?)`                                   | Fixed-step driver: `advance(elapsedMs, inputs)`, `stepOnce`, `pause`, `resume`, `reset` |
| `TICK_RATE`, `TICK_MS`, `ARENA_WIDTH`, `FIGHTER_WIDTH`, `WALK_SPEED` | Constants                                                                               |
| `PlayerInput`, `FrameInputs`, `NEUTRAL_INPUT`                        | Per-tick input contract consumed by `step`                                              |

`@mortal-doctrine/simulation/testing` exports fixtures for tests, benchmarks and labs:
`IDLE`, `P1_RIGHT`, `P1_LEFT`, `walkCycleScript`, `runFrames`, `InputScript`.

## Usage

```ts
import { createInitialState, serializeState, step } from '@mortal-doctrine/simulation';
import { runFrames, walkCycleScript, P1_RIGHT } from '@mortal-doctrine/simulation/testing';

const next = step(createInitialState(), P1_RIGHT); // next.frame === 1
const later = runFrames(createInitialState(), walkCycleScript, 600);
const saved = serializeState(later);
```

In a host loop:

```ts
const runner = createSimulationRunner();
onDisplayFrame((elapsedMs) => {
  runner.advance(elapsedMs, [keyboard.read(), NEUTRAL_INPUT]);
  renderer.render(runner.state);
});
```

## Tests

`pnpm --filter @mortal-doctrine/simulation test` · `... bench`
