# Development

Commands are listed in the [README](../README.md#commands). This page covers workflows.

## Dev servers

- `pnpm dev` starts both apps in parallel; `pnpm dev:game` / `pnpm dev:studio` start one.
- Default ports: game 5173, Studio 5174. Both use `strictPort`: if the port is taken, Vite exits
  with an error instead of silently moving. Override per run:
  `pnpm dev:game --port 6100` (arguments pass through to Vite).
- Stop with Ctrl+C in the terminal that started them.
- **Windows note.** A kill does not propagate down the process tree on Windows, so the root dev
  scripts run through `scripts/dev.ts`. It watches the `pnpm` run that started it (the script
  shell, `pnpm` and its shims) and, when one of those processes is killed from Task Manager,
  `taskkill` or a job runner, ends the whole tree within a few seconds, `node … vite` included.
  This covers the root scripts only: an app's own `pnpm dev`, or a kill of the launcher process
  alone, still leaves its children running. On Linux the launcher only passes the command and
  SIGTERM through.
- `pnpm test:e2e` never reuses a running dev server; it starts and stops its own on free ports.
  Orch's checks never run `pnpm dev`, and agents doing browser verification use Playwright specs
  rather than background dev servers.

## Known technical debt

None recorded.

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
- The Pose Constraints Lab (`/labs/pose-constraints`) runs the mannequin's rest pose through the
  production constraint stage (`MANNEQUIN_REACH`: two-bone IK on the right arm, an aim on the
  head, angle limits). Drag the target or type its position; a mix slider and a bend control
  change the constraint data. The SVG view draws the limit arcs; readouts show the target, the
  end effector, its distance from the shoulder against full reach, and each limited bone's
  rotation.
- The Arena Lab (`/labs/arena`) draws `PLACEHOLDER_ARENA` with the production arena renderable
  (renderer placeholders off), paused at frame 0. Pan (Left / Hold / Right) makes both fighters
  walk through production `step`; the production camera frames them. Play/Pause, Step, Reset and
  one visibility toggle per arena layer; readouts show the frame, the visible span and the
  fighters' midpoint.
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
