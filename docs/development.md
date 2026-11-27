# Development

Commands are listed in the [README](../README.md#commands). This page covers workflows.

## Dev servers

- `pnpm dev` starts both apps in parallel; `pnpm dev:game` / `pnpm dev:studio` start one.
- Default ports: game 5173, Studio 5174. Both use `strictPort`: if the port is taken, Vite exits
  with an error instead of silently moving. Override per run:
  `pnpm dev:game --port 6100` (arguments pass through to Vite).
- Stop with Ctrl+C in the terminal that started them. On Windows, killing only the parent `pnpm`
  process (e.g. from a task manager or a background-job runner) can orphan the `vite` children;
  stop those too.
- `pnpm test:e2e` never reuses a running dev server; it starts and stops its own on free ports.

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
(Vitest, ESLint, typecheck, boundaries) — no root edits needed, except an ESLint determinism block
for simulation-layer packages (see [architecture.md](architecture.md#layers--implemented-enforced)).

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
  submission; GPU time excluded). The game shows frame number and FPS.
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
