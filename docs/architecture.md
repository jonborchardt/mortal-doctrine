# Architecture

Sections are marked **Implemented** (exists and is enforced today) or **Intended** (direction for
future milestones, not yet built). Decision records live in [decisions/](decisions/).

## Overview — Implemented

```text
 keyboard ──▶ input ──▶ PlayerInput ─┐
                                     ▼
                 simulation (pure, 60 Hz fixed step)
                 state + inputs ──step──▶ new state
                                     │ read-only snapshot
                                     ▼
                     renderer (PixiJS, display rate)
                                     ▲
           apps/game, apps/studio: compose the above; React for UI only
```

- The **app** owns the loop: each display frame (Pixi ticker) it feeds elapsed time to the
  simulation runner, which runs zero or more fixed 60 Hz ticks, then hands the latest state to
  the renderer. Simulation and display rates are independent.
- **React** renders shells, menus and lab controls. Per-frame values (frame counter, FPS, state
  view) are written straight to DOM nodes from the loop, never through React state.

## Layers — Implemented (enforced)

| #   | Layer          | Contains                                                        | Today               |
| --- | -------------- | --------------------------------------------------------------- | ------------------- |
| 1   | `foundation`   | math primitives, narrowly scoped shared contracts               | —                   |
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

ESLint adds file-level rules: no deep imports (`@mortal-doctrine/x/internal`), no React outside
`apps/`, and in `packages/simulation` no `pixi.js`, `node:*`, `Date` or `Math.random`. The
simulation `tsconfig` has no DOM lib and no ambient types, so browser and Node APIs are type
errors there.

**Input is split across two layers.**

- _Device capture_ (keyboard, gamepad, bindings, per-frame sampling and buffering of raw device
  state) reads browser APIs, so it is `presentation` (today: `@mortal-doctrine/input`). It
  produces device-neutral per-frame input values defined by the simulation.
- _Command interpretation_ (input history, motion recognition such as quarter-circles, charge
  inputs, chords, buffering windows, negative edge) is gameplay logic. It is deterministic,
  headless `simulation`-layer code that consumes recorded input frames. That makes it testable
  from scripted input and identical in replays and rollback. It never sees a DOM event.

**Skeletal work is split across three responsibilities.**

- _Rig evaluation_ (bone hierarchy, attachments, local→world transforms, IK) and _animation
  evaluation_ (keyframes, interpolation, blending, deformation weights) are `animation` layer:
  pure TypeScript, no PixiJS or browser APIs, runnable in Node tests.
- _Skeletal rendering_ (turning an evaluated pose into Pixi sprites/meshes) is `presentation`.

When a new simulation-layer package (e.g. `combat`) arrives, add the same determinism ESLint
block for it in `eslint.config.js` and give it a DOM-free `tsconfig` (copy `packages/simulation`).

### Rules that tools cannot fully enforce

- Apps compose subsystems; reusable engine logic belongs in `packages/`. Studio labs must call
  production packages, never reimplement them.
- Shared contracts stay small. A type moves into a `foundation` contracts package only when two
  packages need it and neither should own it. No catch-all `utils` package.
- Engine code contains no character- or arena-specific behavior. Character-specific mechanics
  plug in through engine contracts (to be designed in M2/M3).

## Simulation rules — Implemented (partly), binding for all future work

### Authoritative state

- All gameplay-relevant state is in the simulation state object; nothing gameplay-relevant lives
  in renderers, React state or closures.
- State is plain JSON-compatible data, defined by a Zod schema (`simulationStateSchema`) and
  round-trippable through `serializeState` / `deserializeState`.
- State is typed `readonly` and treated as immutable: `step` returns a new state. Presentation
  receives the same object as a read-only snapshot.
- Ownership: each subsystem owns a named slice of state and the operations that change it.
  Slices are composed by the simulation package; no subsystem writes another's slice.

### Time

- Gameplay time is the integer `frame` counter at `TICK_RATE = 60`. Durations in content are
  integer frames.
- The simulation never reads a clock. `createSimulationRunner` converts host-supplied elapsed
  milliseconds into whole ticks (accumulator, catch-up capped at 250 ms).
- Runner semantics: `pause()` stops `advance` and discards accumulated time; `stepOnce()` runs
  exactly one tick whether paused or not; `resume()` continues from the current state; `reset()`
  restores the initial state and keeps the pause flag.
- Rendering may interpolate between the previous and current snapshot (Intended; not needed
  until motion is fast enough to show judder).

### Determinism

- Same initial state + same input sequence ⇒ byte-identical serialized state (tested).
- Gameplay numbers are integers in world units today. Fractional precision, if needed, is a
  deliberate M1 decision (likely integer sub-units). Fixed-point math only with a concrete need.
- **Randomness (Intended, first consumer adds it):** a small seeded PRNG (e.g. 32-bit
  xorshift/mulberry) whose state is an integer field in simulation state, advanced only by
  simulation operations. Never `Math.random`.
- Iterate arrays in index order; never let `Map`/`Set` insertion order or object key order decide
  gameplay outcomes unless that order is itself deterministic and documented.
- Simultaneous interactions resolve in a stable documented order (e.g. player index, then entity
  id).

### Simulation events

**Intended (introduced by the first ticket that needs events).** Convention:

```ts
type SimulationEvent =
  | { readonly type: 'hit'; readonly frame: number; readonly attacker: 0 | 1; ... }
  | { readonly type: 'ko'; readonly frame: number; readonly loser: 0 | 1 };

function step(state, inputs): { state: SimulationState; events: readonly SimulationEvent[] };
```

- Discriminated unions on `type`, plain serializable data, stamped with the `frame` that produced
  them.
- Returned from the simulation operation as an ordered array. Order = the order the simulation
  resolved them (stable, see determinism).
- Consumers (effects, audio, camera, replay, UI) read the array for the frames they observed.
  There is no global event bus and no subscription from inside the simulation.
- Events are outputs only: they never feed back into gameplay.

## Presentation — Implemented (minimal)

`@mortal-doctrine/renderer` creates a PixiJS application, appends its canvas to a host element,
draws snapshots and exposes `onFrame`, `fps` and `frameCpuMs`. It holds Pixi objects privately and
never mutates simulation state. It draws into a 960×540 logical viewport, CSS-scaled to the host
width.

The 960×540 viewport and the 2× texture resolution are **defaults, not architectural
constraints**. Today the renderer hard-codes them and borrows `ARENA_WIDTH` from the simulation as
its viewport width. Making viewport size, resolution and the world→screen mapping configurable
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
`/labs/<id>`. Only the Simulation Lab exists. See [development.md](development.md#adding-a-studio-lab).

## Deferred functionality (explicit non-goals of M0)

Combat, hitboxes, collision, jumping, combos, special moves, skeletal animation, characters,
arenas, effects, camera, audio, AI, replays, menus, settings, persistence, networking, rollback,
render interpolation, gamepad input, seeded RNG.
