# Development

Commands are listed in the [README](../README.md#commands). This page covers workflows.

## Dev servers

- `pnpm dev` starts both apps in parallel; `pnpm dev:game` / `pnpm dev:studio` start one.
- Default ports: game 5173, Studio 5174. Both use `strictPort`: if the port is taken, Vite exits
  with an error instead of silently moving. Override per run:
  `pnpm dev:game --port 6100` (arguments pass through to Vite).
- Stop with Ctrl+C in the terminal that started them. See the Windows cleanup debt below.
- `pnpm test:e2e` never reuses a running dev server; it starts and stops its own on free ports.

## Known technical debt

- **Windows dev-server cleanup.** Killing only the parent `pnpm` process (from Task Manager or
  a background-job runner, rather than Ctrl+C in its console) leaves the `vite` children running
  on Windows, because the kill does not propagate to the process tree. Workaround: stop dev
  servers with Ctrl+C, or end the leftover `node … vite` processes. Orch's checks never run
  `pnpm dev`: they are `pnpm install`, `pnpm check` and `pnpm test:e2e`, whose Vite servers
  Playwright starts and tears down itself (verified to leave no processes on Windows). Agents
  doing browser verification should therefore use Playwright specs, not background
  `pnpm dev`. If unattended runs ever need dev servers, fix this first, e.g. with a small
  cross-platform launcher that kills the process tree.

## Adding a workspace package

Create a package only for meaningful isolation (a subsystem with its own responsibility, public
API and tests) — not for every module, and never empty "for later". Use the
`create-subsystem` skill; `packages/simulation` is the reference.

```text
packages/<name>/
  package.json     name @mortal-doctrine/<name>, "mortalDoctrine": { "layer": ... },
                   "exports", scripts typecheck/test, every directly imported dependency
  tsconfig.json    extends ../../tsconfig.base.json; layer-appropriate "lib"
  README.md        responsibility, non-goals, permitted dependencies, usage example
  src/index.ts     the public API (only what consumers need)
  src/testing.ts   optional public fixtures, exported as "./testing"
  tests/           *.test.ts (and *.bench.ts) importing through ../src/index or ../src/testing
```

Then `pnpm install`, and run `pnpm check`. Root configs pick up the new package automatically
(Vitest, ESLint, typecheck, boundaries) — no root edits needed. Determinism lint and the DOM-free
`tsconfig` check apply from the declared layer (`foundation`, `simulation`, `animation`); see
[architecture.md](architecture.md#layers--implemented-enforced).

## Adding a Studio lab

Use the `create-studio-lab` skill. In short:

1. Create `apps/studio/src/labs/<id>/lab.ts`:

   ```ts
   import { lazy } from 'react';
   import type { LabDefinition } from '../../lab-registry';

   export const lab: LabDefinition = {
     id: 'movement',
     name: 'Movement Lab',
     description: 'One sentence on what it lets you observe.',
     route: '/labs/movement',
     category: 'Simulation',
     component: lazy(() => import('./MovementLab').then((m) => ({ default: m.MovementLab }))),
   };
   ```

2. Implement the component next to it. It must:
   - call production packages only (add them to `apps/studio/package.json`);
   - start from a deterministic fixture with no manual setup, and offer Reset to it;
   - own its controls and state, and tear down every renderer, listener and timer on unmount
     (React StrictMode double-mounts in dev, which exposes leaks);
   - expose observable values with semantic roles or `data-testid` for Playwright.
3. Add `e2e/studio-<id>.spec.ts` (the `studio` Playwright project matches `studio*.spec.ts`) that
   loads `/labs/<id>` directly.

No central file needs editing: the folder is discovered, and it replaces any "planned" entry with
the same id in `labs/index.ts`.

## Adding a character (intended workflow)

Character APIs do not exist yet (M2–M3). The fixed parts:

- One package per character: `characters/<id>/`, name `@mortal-doctrine/character-<id>`,
  layer `content`, depending only on public engine entry points; never on another character.
- Declarative, schema-validated definitions (stats, moves with frame data, rig, animations,
  effects, audio cues) plus optional custom mechanics through engine-provided extension points.
- Assets under the package's `assets/` with a manifest; see
  [content-conventions.md](content-conventions.md).
- Adding a character must not require engine changes for ordinary behavior. If it does, the
  engine contract is missing something: raise a separate ticket.

## Diagnostics and performance

- The Simulation Lab shows target and measured tick rate, render FPS, simulation update time per
  display frame and frame CPU time (`renderer.frameCpuMs`: callbacks + scene update + draw
  submission; GPU time excluded). It also shows the seed, the RNG state, recent raw input
  history per player (direction and button glyphs) and an event log with frame numbers. Its
  rendering controls select the viewport (recreating the loop), toggle interpolation (with an
  alpha readout), register a lab-local fixture renderable in a chosen layer and pick its texture
  resolution; a readout lists every fixture's update count, destroy count and texture release. The game
  shows frame number, FPS and player one's x in world units.
- The Input Lab (`/labs/input`) shows, per player, raw device state (held keys, gamepad buttons
  and stick), presses latched for the next tick, the frames sampled each tick, and a log of
  latched taps. Pause and Step make single ticks observable.
- The Command Lab (`/labs/commands`) plays a scripted fixture (or live input) through `step` with
  the generic commands and shows the frame, each player's facing and input timeline, and the
  recognized commands with frame numbers. Pause and Step make single ticks observable.
- The Movement Lab (`/labs/movement`) plays a movement scenario (`MOVEMENT_SCENARIOS`) with a
  chosen placeholder parameter set through production `step`, paused at frame 0. An SVG view
  draws both pushboxes (resizing when crouching or airborne) and each fighter's trajectory;
  readouts show the frame and each fighter's x, y, vx, vy, facing and state, plus the movement
  event log. Play/Pause, Step and Reset; live input is not supported yet.
- Diagnostics are measured by the host app around simulation calls; the simulation itself never
  reads clocks.
- `pnpm bench` runs headless Vitest benchmarks (`tests/*.bench.ts`). Compare results only on the
  same machine; there are no CI performance thresholds.

### Baseline (2026-11-26, hello world)

Intel i7-4930K (2013 desktop), Windows 10, Node 24.19, Chromium via Playwright:

| Measurement                          | Result                                 |
| ------------------------------------ | -------------------------------------- |
| `pnpm bench`: 3600 simulation frames | ~1.05 ms mean (~0.3 µs/tick)           |
| Studio Simulation Lab, steady state  | 60 FPS, 60 ticks/s, frame CPU ≈ 0.3 ms |

Caveats: Vitest's module runner adds per-call overhead to cross-module imports (it prints a
warning) so the benchmark overstates real cost; browser numbers are from a headed dev build with
vsync and say nothing about lower-end hardware.
