---
name: create-subsystem
description: Use when a ticket introduces a new engine subsystem or workspace package in Mortal Doctrine (e.g. movement, collision, skeleton, camera) — deciding whether it needs its own package, choosing its layer, defining its public API, and adding tests, fixtures and a Studio lab.
---

# Create a subsystem

Authoritative references: `docs/architecture.md` (layers, simulation rules, events),
`docs/development.md#adding-a-workspace-package`, `docs/testing.md`. Reference package:
`packages/simulation`.

## 1. Decide the boundary

- New package only if it has its own responsibility, public API and tests, and a consumer in this
  ticket. Otherwise add a module inside the package that owns the behavior.
- Pick the layer from what it must import, not what is convenient: gameplay → `simulation`;
  rig/animation evaluation → `animation`; anything touching Pixi, DOM, audio or devices →
  `presentation`; shared math/contracts used by ≥2 packages → `foundation`.
- If it needs a higher layer, the design is wrong — invert the dependency (higher layer passes
  data or callbacks down) instead.
- If it needs a change to a shared contract (e.g. simulation state shape, `step` signature), make
  the smallest extension and call it out in the summary.

## 2. Scaffold

Copy the shape of `packages/simulation`:

- `package.json`: `name` `@mortal-doctrine/<dir>`, `"mortalDoctrine": { "layer": "<layer>" }`,
  `exports` (`.` and optionally `./testing`), scripts `typecheck: tsc` and `test: vitest run`.
- Add dependencies with pnpm so they land in this package:
  `pnpm --filter @mortal-doctrine/<dir> add <dep>`; internal deps as `"workspace:*"`; vitest as a
  devDependency if it has tests.
- `tsconfig.json`: extend `../../tsconfig.base.json`, `include: ["src", "tests"]`. Simulation and
  animation layers: no DOM lib, no `types`. Presentation: add `"DOM"` to `lib`.
- Simulation layer: copy the `packages/simulation/**` determinism block in `eslint.config.js` for
  the new path (the one root-config edit that is expected).
- `README.md`: layer, permitted dependencies, responsibility, non-goals, API table, usage example.

## 3. Implement

- Export only what consumers need from `src/index.ts`; everything else stays internal.
- Simulation layer: pure functions over readonly, serializable state; integer frames; no clocks
  or `Math.random`; deterministic ordering; events as returned typed arrays (see architecture).
- Put reusable fixtures in `src/testing.ts` (exported as `./testing`).

## 4. Test

- `tests/*.test.ts` through the public entry points. Simulation layer must include the three
  determinism tests in `docs/testing.md`.
- Add a `tests/*.bench.ts` only if performance is a stated concern.

## 5. Lab and integration

- If the subsystem has observable behavior, add a Studio lab (skill `create-studio-lab`).
- Wire into `apps/game` only if the ticket asks for it.
- Document integration points (who calls it, what it consumes/produces) in its README.

Finish with the `verify-implementation` skill.
