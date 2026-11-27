---
name: create-studio-lab
description: Use when adding or substantially changing a Mortal Doctrine Studio lab (apps/studio/src/labs/<id>) — registration, direct URL, fixtures, controls, diagnostics, resource cleanup and Playwright verification with visual evidence.
---

# Create a Studio lab

References: `docs/development.md#adding-a-studio-lab`, `docs/decisions/0006-studio-labs.md`.
Working example: `apps/studio/src/labs/simulation/`.

## 1. Register (no shared files)

Create `apps/studio/src/labs/<id>/lab.ts` exporting `lab: LabDefinition` with `id` = folder name
(kebab-case), `route: '/labs/<id>'`, a one-sentence `description`, a `category` from
`LAB_CATEGORIES`, and `component: lazy(() => import('./XLab').then((m) => ({ default: m.XLab })))`.
Discovery is automatic and it supersedes the planned entry of the same id. Do not edit `App.tsx`.
`buildLabIndex` throws on convention violations; the error message says what to fix.

## 2. Build the component

- Use production packages only; add each to `apps/studio/package.json` with `workspace:*`. If the
  lab needs logic that does not exist in a package, that logic belongs in the package (or a
  separate ticket), not in the lab.
- Start from a deterministic fixture (prefer the package's `/testing` exports) so the lab shows
  something meaningful immediately; provide Reset to that state.
- Own all state locally. Per-frame updates go straight to DOM nodes from the loop (see
  `data-readout` in the Simulation Lab), never through React state.
- Lifecycle: create renderers, listeners, timers inside `useEffect`; guard against unmount during
  async setup (`disposed` flag); destroy everything in cleanup. StrictMode double-mount in dev will
  leave a second canvas if you leak.
- Expose observable behavior: labelled controls (`<button>` with clear names), diagnostics in a
  labelled `<dl>`, and `data-testid` on values tests must read.
- Errors: catch async setup failures, `console.error` them and show them in the UI.

## 3. Verify

- Add `e2e/studio-<id>.spec.ts`; `page.goto('/labs/<id>')` directly. Assert behavior (values
  change in the expected way, reset returns to the fixture), assert exactly one canvas if it
  renders, and use auto-retrying assertions only.
- Run `pnpm test:e2e --project studio`, then the `verify-implementation` skill.
- Visual evidence for review: screenshot(s) of the lab at a known fixture state (paused at a known
  frame where applicable), the direct URL, and reproduction steps.
