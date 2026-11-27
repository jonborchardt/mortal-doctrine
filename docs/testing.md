# Testing

| Kind               | Tool       | Location                                                | Runs in  |
| ------------------ | ---------- | ------------------------------------------------------- | -------- |
| Unit / integration | Vitest     | `packages/*/tests`, `apps/*/tests`, `scripts/*.test.ts` | Node     |
| Benchmarks         | Vitest     | `packages/*/tests/*.bench.ts`                           | Node     |
| Browser            | Playwright | `e2e/<app>*.spec.ts`                                    | Chromium |

`pnpm test` runs all Vitest tests from the root; `pnpm --filter @mortal-doctrine/<pkg> test` runs
one package. `pnpm test:e2e` runs browser tests; append `--project studio` or a file name to
narrow.

## Unit tests

For math, state transitions, input interpretation, deterministic algorithms, schema validation
and single-subsystem behavior. Fast, deterministic, no browser, no network, no clocks.

## Integration tests

For public package interfaces, subsystem interactions, serialization round trips, event
production and app composition logic (e.g. the Studio lab registry). Import through the package's
public entry points (`src/index.ts`, `src/testing.ts`), not internal files.

## Required determinism tests

Every simulation-layer subsystem must show:

1. Identical state + inputs ⇒ identical serialized state and identical events over a long
   scripted run.
2. Serialize mid-run → restore → continue equals an uninterrupted run, in state and events.
3. Operations never mutate their input state.

## Fixtures

- Packages publish reusable fixtures from `src/testing.ts`, exported as
  `@mortal-doctrine/<pkg>/testing`. Production code never imports `testing`.
- Simulation fixtures today: `held(...bits)` (builds an `InputFrame`), `IDLE`, `P1_RIGHT`,
  `P1_LEFT`, `SEEDED_OPTIONS` (non-default seed and history capacity), `walkCycleScript` (an
  `InputProvider` mapping absolute frame → `FrameInputs`; left/right only) and
  `runFrames(state, script, count) → { state, events }`.
- Movement fixtures (`@mortal-doctrine/movement/testing`): `RAMPED_MOVEMENT_PARAMETERS` (the
  second placeholder set, with acceleration and friction ramps) and `PARAMETER_SETS`,
  `MOVEMENT_SCENARIOS` (walk forward/back, crouch, neutral/forward/back jump, corner push,
  cross-up, max separation; player 1's scripted input), the mirror helpers (`mirrorFrame`,
  `mirrorInputs`, `mirrorFighter`, `mirrorSlice`, `mirrorEvent`) for symmetry tests and the
  `runMovement` harness. Kinematics frame tables in `packages/movement/tests` are literals
  derived independently of the code under test.
- Command fixtures (`@mortal-doctrine/commands/testing`): generic definitions (`GENERIC_COMMANDS`
  and each one by name), `MOTION_CASES` with `spanned` for window boundary tables, `mirror`,
  `COMMAND_SCRIPTS` / `commandCycleScript` (inputs for both players), and the
  `startRun` / `advanceRun` recognizer harness.
- Keep fixtures small, readable and built from public APIs. Before production characters exist,
  use geometric placeholders and reference mannequins (future: a minimal test rig in the skeleton
  package), never production content.

## Browser tests

- Playwright starts each app on a free port and sets `baseURL` per project (`game`, `studio`);
  use relative URLs (`page.goto('/labs/simulation')`).
- Prefer roles and accessible names; use `data-testid` for values without semantics (frame
  counters, state dumps).
- Assert behavior, not existence: counters advance, Step adds exactly one frame, keys move x.
- Wait with auto-retrying assertions (`expect(...).toHaveText`, `expect.poll`). Never
  `waitForTimeout`.
- Labs are tested by loading their URL directly.

## Visual evidence

Tickets that change visuals include screenshots (before/after when changing existing visuals),
the direct Studio lab URL, and reproduction steps. Visual regression tests, when warranted, use a
deterministic fixture paused at a known frame and compare a cropped canvas region with a
tolerance — not pixel-perfect full-page snapshots. None exist yet.

## CI

GitHub Actions runs `pnpm check` and `pnpm test:e2e` on Ubuntu and Windows with a frozen
lockfile; Playwright reports and traces are uploaded on failure. Headless Chromium uses
SwiftShader for WebGL (`--enable-unsafe-swiftshader`).
