# @mortal-doctrine/sim-core

**Layer:** `foundation` · **May depend on:** `zod` only (no workspace package).

The small deterministic contracts and primitives that every simulation-layer package shares:
time constants, the integer numeric convention and its checked helpers, the `InputFrame`
contract with the single opposing-direction policy, the seeded RNG, and the event envelope.

**Admission rule:** something belongs here only if it is a contract or deterministic primitive
**needed by at least two simulation-layer packages; never gameplay rules**. Everything else stays
in the package that owns the behavior (`simulation` owns `SimulationState`, `step`,
serialization and the runner).

**Non-goals:** gameplay rules (movement, collision, combat), state composition, an event bus, a
numeric framework (vectors, fixed-point types), device input, presentation, Node or browser APIs.
Determinism lint and the DOM-free `tsconfig` apply here because the layer is `foundation`.

## API

| Export                                                                | Purpose                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `TICK_RATE`, `TICK_MS`                                                | 60 Hz fixed step; `TICK_MS` is only for hosts converting wall time into ticks                                        |
| `SUBUNITS_PER_UNIT`                                                   | `100` integer sub-units per world unit (the only definition in the repository)                                       |
| `INT32_MIN`, `INT32_MAX`, `int32Schema`, `assertInt32(value, name?)`  | The stored-value range and its Zod schema / throwing check                                                           |
| `divTrunc(a, b)`                                                      | Integer division truncating toward zero; exact for all safe integers                                                 |
| `scaleRatio(value, num, den)`                                         | `value * num / den` truncated toward zero; throws if `value * num` is not a safe integer                             |
| `decelerate(velocity, amount)`                                        | Moves a velocity toward zero by `amount >= 0`, clamped at zero                                                       |
| `InputBit`, `InputBitName`, `InputFrame`, `NEUTRAL_INPUT`             | Bitmask: `LEFT` `RIGHT` `UP` `DOWN` on bits 0–3, `A1`–`A6` on bits 4–9; neutral is `0`                               |
| `inputFrameSchema`, `FrameInputs`, `frameInputsSchema`                | One frame is an integer in [0, 1023]; `FrameInputs` is exactly two frames (player 0 first)                           |
| `parseFrameInputs(value)`                                             | Returns valid `FrameInputs` or throws a `TypeError` naming the failing entry                                         |
| `resolveDirection(frame)`, `ResolvedDirection`                        | The opposing-direction policy: left + right → `x: 0`; up + down → `y: 1` (up)                                        |
| `createRngState(seed?)`, `RngState`, `rngStateSchema`, `DEFAULT_SEED` | mulberry32 state `{ state }` (the 32-bit word stored as a signed int32); seeds are integers in [0, 2³²−1], default 0 |
| `nextUint32(rng)`                                                     | `{ rng, value }`, value an unsigned 32-bit integer                                                                   |
| `nextBelow(rng, bound)`                                               | `{ rng, value }`, value in `[0, bound)`, `bound` an integer in [1, 2³²]; unbiased by rejection (deterministic draws) |
| `SimulationEventEnvelope<T>`                                          | `{ type: T; frame }` that every simulation event extends; `frame` is the frame being processed                       |

All helpers reject non-integer arguments with a descriptive `RangeError`; none ever returns an
inexact value.

## Numeric convention

- **Precision:** `SUBUNITS_PER_UNIT = 100`. 1 world unit = 1 logical pixel at the default
  viewport. Positions, sizes and distances are sub-units; velocities are sub-units per frame;
  accelerations are sub-units per frame².
- **Integers only, int32 range:** every value stored in simulation state is an integer in
  [−2,147,483,648, 2,147,483,647] (about ±21.4 million world units). Schemas use `int32Schema`.
- **Intermediates:** products must stay within `Number.MAX_SAFE_INTEGER`; `scaleRatio` checks
  and throws instead of rounding.
- **Rounding:** division and ratio scaling truncate toward zero, so `f(−x) === −f(x)` and
  mirrored fighters behave identically.
- **Repeated scaling:** applying `scaleRatio(v, num, den)` (num < den) n times stays below
  `den / (den − num)` of the exact `v · (num/den)ⁿ` for every n; the error does not accumulate.

## Usage

Inputs and direction:

```ts
import { InputBit, parseFrameInputs, resolveDirection } from '@mortal-doctrine/sim-core';

const inputs = parseFrameInputs([InputBit.LEFT | InputBit.RIGHT | InputBit.A1, 0]);
resolveDirection(inputs[0]); // { x: 0, y: 0 } — the raw frame still holds both directions
```

Movement pattern for M1.05 (acceleration, gravity, friction), all exact integer arithmetic:

```ts
import { decelerate } from '@mortal-doctrine/sim-core';

const ACCEL = 50; // sub-units / frame²
const MAX_SPEED = 600; // sub-units / frame
const FRICTION = 35; // sub-units / frame², applied when not accelerating
const GRAVITY = -90; // sub-units / frame² (+y is up)

// Each frame, velocity first, then position:
vx = accelerating
  ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vx + direction * ACCEL)) // integer addition
  : decelerate(vx, FRICTION); // reaches exactly 0 and stays there
vy += GRAVITY; // y after n frames is exactly n·vy0 + GRAVITY·n(n+1)/2
x += vx;
y += vy;
// For proportional damping use scaleRatio(vx, 15, 16): bounded, sign-symmetric truncation.
```

The same pattern runs for 600 frames in `tests/numeric.test.ts` against closed-form integers,
with the mirrored run exactly negated.

Randomness (no gameplay draws yet; the first consumer adds them inside `simulation`'s rng slice
owner):

```ts
import { createRngState, nextBelow } from '@mortal-doctrine/sim-core';

let rng = createRngState(42);
const roll = nextBelow(rng, 6); // roll.value in [0, 6)
rng = roll.rng; // store the new state back in simulation state
```

## Tests

`pnpm --filter @mortal-doctrine/sim-core test` — numeric helpers (truncation, symmetry over int32
limits, overflow guards, repeated scaling, the movement pattern), input-frame validation and the
16-combination direction table, RNG golden sequences for seeds 0, 1 and 2³²−1, seed and bound
validation, and mid-sequence serialization.
