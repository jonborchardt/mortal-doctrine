# Mortal Doctrine — engineering rules

Browser-native, strictly 2D fighting game (satirical personifications of world religions) plus a
Studio of development labs. TypeScript (strict) · React · Vite · PixiJS v8 · Zod · Vitest ·
Playwright · pnpm workspaces · Node 24. Custom deterministic simulation and custom declarative
skeletal animation — no physics/3D engines or commercial animation runtimes.

These rules are mandatory. Details live in `docs/`; procedures live in `.claude/skills/`.

## Architectural invariants

- **Simulation is authoritative, pure and headless.** No React, PixiJS, DOM, audio, Node APIs,
  `Date`, `performance` or `Math.random` in simulation-layer packages. Fixed 60 Hz; gameplay time
  is integer frames. Randomness is seeded and its state lives in simulation state.
- **State is plain serializable data** (no DOM/render objects, callbacks, promises, class
  instances). It round-trips through its Zod schema. Changes only via simulation operations
  (`step` etc.); identical state + inputs ⇒ identical result.
- **Presentation reads snapshots, never writes them.** Rendering, effects, camera and audio
  consume read-only state and typed simulation events. Visual animation never decides gameplay
  timing.
- **React is UI only.** It never runs per-frame work; loops write diagnostics directly.
- **Events** are typed, serializable, frame-stamped values returned from simulation operations in
  deterministic order. No global event bus. See `docs/architecture.md#simulation-events`.
- **Characters and arenas are content.** Engine packages never reference a specific character or
  arena. Content uses public engine entry points only; content packages never depend on each other.

## Dependency rules (enforced by `pnpm check:boundaries` and ESLint)

Layers, low → high: `foundation` → `simulation` → `animation` → `presentation` → `content` →
`application`. Depend only on the same or lower layers. No cycles, no deep imports (only declared
`exports`: `.` and optionally `./testing`), every import declared in the importing package's own
`package.json`, internal deps as `workspace:*`. Apps compose; reusable engine code goes in
`packages/`. Never add a catch-all `utils`/`common`/`shared` package. `docs/architecture.md`.

## Build and verification

- pnpm only. Never edit `pnpm-lock.yaml` by hand; commit it with dependency changes.
- Before declaring work done: `pnpm check` (format, lint, typecheck, boundaries, unit tests,
  builds) **and** `pnpm test:e2e` when anything browser-facing changed. Report real output.
- New dependencies need a stated reason, belong to the package that imports them, and must be a
  stable release (pnpm enforces a minimum release age; do not bypass it).

## Never weaken quality gates

Do not skip/disable/delete failing tests, remove assertions, loosen `tsconfig`, add
`eslint-disable` or lint-rule exceptions to silence violations, add sleeps to hide races, exclude
directories from checks, bypass boundary violations, or update snapshots without inspecting the
change. A failing gate is a defect to investigate. If an unrelated pre-existing failure blocks
you, report it with reproduction output — never claim verification you did not get.

## Testing

Test observable behavior through public entry points. Simulation tests run in Node with
deterministic fixtures (`@mortal-doctrine/<pkg>/testing`). Browser behavior is verified with
Playwright using semantic selectors, `data-testid` where needed, and auto-retrying assertions —
never fixed waits. Bug fixes include a regression test. `docs/testing.md`.

## Ticket scope

Implement exactly the accepted ticket. If a prerequisite is missing, do the smallest in-scope
extension or stop and document it as a recommended separate ticket — never silently build an
unrelated subsystem. No opportunistic refactors or unrelated formatting. Changes to shared
contracts, root config or layer rules must be intentional and called out in the summary. Do not
create, start, close or modify Orch tickets unless explicitly instructed.

## Worktrees and parallel development

Work from any checkout path; never hard-code absolute paths, global temp files or fixed ports in
tests. `pnpm test:e2e` starts its own servers on free ports — never point tests at an existing
server. Keep new code in subsystem-local files, new labs in their own folder
(`apps/studio/src/labs/<id>/`), and character content in its own `characters/<id>/` package.
Stop every process you start.

## Where to look

- `docs/architecture.md` — layers, boundaries, simulation rules, events, implemented vs. intended
- `docs/development.md` — commands, adding packages / labs / characters, diagnostics
- `docs/testing.md` · `docs/build-system.md` · `docs/content-conventions.md` · `docs/roadmap.md`
- `docs/decisions/` — architectural decision records
- Skills: `create-subsystem`, `create-studio-lab`, `verify-implementation`
