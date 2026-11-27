# Architecture

Sections are marked **Implemented** (exists and is enforced today) or **Intended** (direction for
future milestones, not yet built). Decision records live in [decisions/](decisions/).

## Overview — Implemented

```text
 keyboard, gamepad ──▶ input ──▶ InputFrame (sim-core bitmask), once per tick
                                     ▼
                 simulation (pure, 60 Hz fixed step, built on sim-core)
                 state + FrameInputs ──step──▶ { state, events }
                                     │ read-only snapshot + events
                                     ▼
                     renderer (PixiJS, display rate)
                                     ▲
           apps/game, apps/studio: compose the above; React for UI only
```

- The **app** owns the loop: each display frame (Pixi ticker) it feeds elapsed time to the
  simulation runner, which runs zero or more fixed 60 Hz ticks, then hands the latest state to
  the renderer. The runner asks an input provider for `FrameInputs` once per tick. Simulation
  and display rates are independent.
- **React** renders shells, menus and lab controls. Per-frame values (frame counter, FPS, state
  view) are written straight to DOM nodes from the loop, never through React state.

## Layers — Implemented (enforced)

| #   | Layer          | Contains                                                        | Today               |
| --- | -------------- | --------------------------------------------------------------- | ------------------- |
| 1   | `foundation`   | math primitives, narrowly scoped shared contracts               | `sim-core`, `math`  |
| 2   | `simulation`   | headless gameplay: state, stepping, movement, collision, combat | `simulation`        |
| 3   | `animation`    | presentation-independent skeleton and animation evaluation      | —                   |
| 4   | `presentation` | rendering, effects, camera, audio, browser device adapters      | `renderer`, `input` |
| 5   | `content`      | `characters/*`, `arenas/*`                                      | —                   |
| 6   | `application`  | `apps/*` composition and tooling                                | `game`, `studio`    |

A package declares its layer in `package.json`:

```json
"mortalDoctrine": { "layer": "simulation" }
```

`pnpm check:boundaries` ([scripts/check-boundaries.ts](../scripts/check-boundaries.ts)) fails when:

- a package depends on a higher layer, or a content package depends on another content package;
- the workspace dependency graph has a cycle;
- a source file imports a package not declared in that package's own `package.json`;
- an internal dependency is not `workspace:*`;
- a package's name, location or layer disagree (`packages/x` → `@mortal-doctrine/x`,
  `characters/x` → `@mortal-doctrine/character-x`, `arenas/x` → `@mortal-doctrine/arena-x`);
- a non-app package lacks `exports` or `README.md`.

**Known limitation (accepted for now):** the checker finds imports by regex over source text
(`import … from '…'`, `export … from '…'`, `import('…')`, side-effect imports). It does not build
a module graph, so it cannot see computed specifiers. Therefore computed `import()` specifiers
are prohibited everywhere and ESLint rejects them (`no-restricted-syntax`). Upgrade to real
module-graph analysis (TypeScript resolution or a dedicated tool) only when this rule becomes a
practical obstacle or a violation slips through.

ESLint adds file-level rules: no deep imports (`@mortal-doctrine/x/internal`) and no React outside
`apps/`.

**Determinism enforcement is derived from the declared layer.** Every package whose
`mortalDoctrine.layer` is `foundation`, `simulation` or `animation` is covered; there is no
hand-maintained path list. `eslint.config.js` builds its determinism block with
`determinismLintConfig(loadWorkspace(...))` from `scripts/check-boundaries.ts`, forbidding
`Date`, `performance`, `Math.random`, `pixi.js`, `react*` and `node:*`. `pnpm check:boundaries`
fails if such a package's own `tsconfig.json` is missing, lists a DOM lib or declares non-empty
`types` (only the package's own file is inspected, not its `extends` chain), so browser and
Node APIs are type errors there. A new deterministic package needs no root-config edit.

**Input is split across two layers.**

- _Device capture_ (keyboard, gamepad, bindings, per-frame sampling and buffering of raw device
  state) reads browser APIs, so it is `presentation` (today: `@mortal-doctrine/input`). It
  produces device-neutral `InputFrame` values defined by `sim-core`.
- _Command interpretation_ (input history, motion recognition such as quarter-circles, charge
  inputs, chords, buffering windows, negative edge) is gameplay logic. It is deterministic,
  headless `simulation`-layer code that consumes recorded input frames. That makes it testable
  from scripted input and identical in replays and rollback. It never sees a DOM event.

**Skeletal work is split across three responsibilities.**

- _Rig evaluation_ (bone hierarchy, attachments, local→world transforms, IK) and _animation
  evaluation_ (keyframes, interpolation, blending, deformation weights) are `animation` layer:
  pure TypeScript, no PixiJS or browser APIs, runnable in Node tests.
- _Skeletal rendering_ (turning an evaluated pose into Pixi sprites/meshes) is `presentation`.

When a new simulation-layer package (e.g. `combat`) arrives, declare its layer and give it a
DOM-free `tsconfig` (copy `packages/simulation`); the determinism rules then apply automatically.

### Rules that tools cannot fully enforce

- Apps compose subsystems; reusable engine logic belongs in `packages/`. Studio labs must call
  production packages, never reimplement them.
- Shared contracts stay small. `sim-core` admits a contract or deterministic primitive only when
  it is needed by at least two simulation-layer packages, and never gameplay rules. No catch-all
  `utils` package.
- Engine code contains no character- or arena-specific behavior. Character-specific mechanics
  plug in through engine contracts (to be designed in M2/M3).

## Simulation rules — Implemented, binding for all future work

### Contract placement

- `@mortal-doctrine/sim-core` (`foundation`, depends only on `zod`) owns the shared contracts:
  `TICK_RATE`/`TICK_MS`, `SUBUNITS_PER_UNIT` and the checked numeric helpers, the `InputFrame`
  bits and schema, `FrameInputs`, the opposing-direction resolver, the RNG and the event envelope.
- `@mortal-doctrine/simulation` is the composition package: `SimulationState`, `step`,
  serialization and the runner. It does not re-export `sim-core`; consumers import each symbol
  from the package that defines it.
- Future subsystem packages depend on `sim-core`; `simulation` depends on them. The graph stays
  acyclic.

### Authoritative state

- All gameplay-relevant state is in the simulation state object; nothing gameplay-relevant lives
  in renderers, React state or closures.
- State is plain JSON-compatible data, defined by a Zod schema (`simulationStateSchema`) and
  round-trippable through `serializeState` / `deserializeState`. The serialized form is
  `{ "schemaVersion": 1, "state": … }`; an unsupported version throws naming the found and
  supported versions, invalid state throws naming the failing path, and nothing is partially
  restored. There is no migration framework until a real migration exists.
- State is typed `readonly` and treated as immutable: `step` returns a new state. Presentation
  receives the same object as a read-only snapshot.
- Ownership: `SimulationState` is `{ frame, rng, input, fighters }`. Each slice has one owning
  module (`packages/simulation/src/rng.ts`, `input.ts`, `fighters.ts`) exporting its Zod schema,
  its initial value and a pure `(slice, readonlyContext) → { slice, events }` update. No module
  reads or writes another's slice except through the read-only context `step` passes it (the
  processed `frame`, the raw `FrameInputs` and read-only views of other slices). There is no
  registration mechanism or mutation hook: adding a subsystem means one explicit call in `step`
  and one slice in the schema.
- **Phase order** (also written in `step.ts`): (1) input history append, (2) walk/bounds using
  the resolved direction, (3) collect events; then `frame + 1`. The `rng` slice has no phase
  yet (no gameplay draws), so `step` leaves it unchanged.

### Time

- Gameplay time is the integer `frame` counter at `TICK_RATE = 60`. Durations in content are
  integer frames.
- The simulation never reads a clock. `createSimulationRunner(options)` converts host-supplied
  elapsed milliseconds into whole ticks (accumulator, catch-up capped at 250 ms) and calls its
  input provider `(frame) => FrameInputs` exactly once per tick.
- Runner semantics: `pause()` stops `advance` (which then never calls the provider) and discards
  accumulated time; `stepOnce()` runs exactly one tick whether paused or not; `resume()`
  continues from the current state; `reset()` rebuilds `createInitialState(options)` (same seed
  and capacity) and keeps the pause flag. The runner exposes no other way to change state.
- Rendering may interpolate between the previous and current snapshot (Intended; not needed
  until motion is fast enough to show judder).

### Determinism

- Same initial state + same input sequence ⇒ byte-identical serialized state and identical event
  lists (tested over 3,600 frames, including serialize → restore → continue).
- **Numeric convention:** all gameplay quantities are integers in sub-units
  (`SUBUNITS_PER_UNIT = 100` per world unit); velocities are sub-units per frame, accelerations
  sub-units per frame². Every stored number is an int32 (schemas enforce it); intermediates stay
  within `Number.MAX_SAFE_INTEGER` and the checked helpers throw rather than return an inexact
  value; division and ratio scaling truncate toward zero, so mirrored behavior is identical.
  Acceleration and gravity are integer additions; friction is `decelerate` (clamped at zero) or a
  bounded `scaleRatio`. See [content-conventions.md](content-conventions.md#coordinates-and-units)
  and the `sim-core` README. No vector or fixed-point types.
- **Randomness:** mulberry32 in `sim-core` as pure functions over `{ state }` (the 32-bit word
  stored as a signed int32), seeded through `createInitialState({ seed })`. Every integer seed
  in [0, 2³²−1] is valid, including the default 0; others throw. Golden sequences for seeds 0, 1
  and 2³²−1 are pinned in tests. `nextBelow` draws unbiased bounded integers by rejection. Only
  the `rng` slice owner may draw, and no gameplay does yet. Never `Math.random`.
- Iterate arrays in index order; never let `Map`/`Set` insertion order or object key order decide
  gameplay outcomes unless that order is itself deterministic and documented.
- Simultaneous interactions resolve in a stable documented order (e.g. player index, then entity
  id).

### Input

**Four kinds of input data, kept distinct:**

1. **Device event buffering** — transient key/gamepad state inside presentation-layer device
   adapters (`@mortal-doctrine/input`). Never simulation state. Key presses are latched until
   the next per-tick sample, so a tap shorter than a tick is not lost; gamepads are polled at
   the sample.
2. **Current authoritative input** — the `FrameInputs` passed to `step` for this frame: exactly
   one `InputFrame` per player. The runner's provider is called once per tick with the frame
   about to be processed.
3. **Gameplay input history** — the bounded `input` slice of simulation state, used by gameplay
   interpretation.
4. **Replay recording** — the complete per-tick `FrameInputs` stream, captured outside simulation
   state by `@mortal-doctrine/replay`, whose recorder wraps the runner's input provider. It never
   derives from the bounded history.

**InputFrame.** A non-negative integer bitmask: `LEFT`, `RIGHT`, `UP`, `DOWN` on bits 0–3,
generic buttons `A1`–`A6` on bits 4–9 (no gameplay meaning yet); other bits must be zero, and new
bits are only ever appended. Neutral (idle, absent, disconnected) is `0`. `step` throws, producing
no state, on a missing or extra player entry, `undefined` or an invalid bitmask; it never guesses.

**Raw versus resolved.** Raw frames are stored as captured, including opposing directions;
history and replays keep raw frames. Gameplay direction comes only from `sim-core`'s
`resolveDirection`: left + right → no horizontal direction, up + down → up. No consumer resolves
directions itself. Press, release and hold are derived by comparing consecutive raw frames in
history; chords and motions from sequences of raw frames.

**History.** `{ capacity, history: [p1, p2] }`: raw frames per player, oldest first, appended
before any other phase so later phases already see the current frame. Capacity is set through
`createInitialState({ historyCapacity })` (integer in [1, 600], default 60) and stored in state;
when full, the oldest frame is dropped. Serialization round-trips it exactly and rejects a
history longer than its capacity.

**Charges longer than the history.** Recognizers (M1.03) keep their own derived counters (e.g.
frames a direction has been held) in their own slice, updated from the current input each
frame. Charge length is therefore not limited by history capacity.

### Simulation events

**Implemented.** `step(state, inputs)` returns `{ state, events }`. Every event extends
`sim-core`'s `SimulationEventEnvelope` (`{ type, frame }`); `simulation` exports the union
`SimulationEvent`. Exactly one event exists today:

```ts
type SimulationEvent = {
  readonly type: 'boundary-contact';
  readonly frame: number; // the frame being processed (the input state's frame)
  readonly player: 0 | 1;
  readonly side: 'left' | 'right';
}; // emitted on the tick a fighter's x reaches an edge it was not already at
```

- Discriminated unions on `type`, plain serializable data, stamped with the processed `frame`.
- Returned as an ordered array: by phase in the fixed phase order, then by ascending player
  index, then by emission order. All events of a frame are returned; none are merged or dropped.
- The array (and each event) is new and frozen every step. Nothing a consumer does with it can
  affect the simulation: the only inputs to `step` are state and `FrameInputs`.
- The runner's `advance` returns `{ ticks, events }` with events in tick order; `stepOnce`
  returns that tick's events.
- Consumers (effects, audio, camera, replay, UI) read the array for the frames they observed.
  There is no global event bus and no subscription from inside the simulation.
- Events are outputs only: they never feed back into gameplay.

## Presentation — Implemented (minimal)

`@mortal-doctrine/renderer` creates a PixiJS application, appends its canvas to a host element,
draws snapshots and exposes `onFrame`, `fps` and `frameCpuMs`. It holds Pixi objects privately and
never mutates simulation state. It draws into a 960×540 logical viewport, CSS-scaled to the host
width.

The 960×540 viewport and the 2× texture resolution are **defaults, not architectural
constraints**. Today the renderer hard-codes its own viewport constants and converts simulation
sub-units to logical pixels by dividing by `SUBUNITS_PER_UNIT`. Making viewport size, resolution and the world→screen mapping configurable
(with the camera owning framing) is rendering-infrastructure work (M1). No code may assume the
logical viewport equals the arena width.

## Animation — Intended

Hierarchical 2D skeletons with illustrated attachments; declarative, serializable,
programmatically authorable definitions; keyframes, interpolation, IK, mesh deformation and
swappable attachments; per-character skeletal extensions (extra limbs, wings, summons). Rig and
animation evaluation are presentation-independent (layer 3) so that any gameplay-relevant
transform can be evaluated deterministically; skeletal rendering is a separate presentation
concern (see Layers). Visual animation never determines combat timing; move frame data does.

## Studio — Implemented (convention), Intended (labs)

Each lab is a folder `apps/studio/src/labs/<id>/` with a `lab.ts` exporting a typed
`LabDefinition`; discovery is automatic (`import.meta.glob`). Every lab has the stable URL
`/labs/<id>`. The Simulation, Input and Replay Labs exist. See [development.md](development.md#adding-a-studio-lab).

## Deferred functionality (explicit non-goals of M0)

Combat, hitboxes, collision, jumping, combos, special moves, skeletal animation, characters,
arenas, effects, camera, audio, AI, menus, settings, persistence, networking, rollback,
render interpolation. (The seeded RNG, simulation events, gamepad input and replays now exist;
see above.)
