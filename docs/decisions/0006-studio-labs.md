# 0006 — Studio labs with convention-based registration

**Status:** Accepted (M0)

**Decision.** The Studio app hosts one lab per subsystem. A lab is a folder
`apps/studio/src/labs/<id>/` whose `lab.ts` exports a typed `LabDefinition`; folders are
discovered with Vite's `import.meta.glob`. Each lab is lazily loaded at the stable URL
`/labs/<id>`. Routing is plain URL paths with full page loads; no router library.

**Context.** Labs are how subsystems are developed, inspected and verified (by humans and by
Playwright) independently of the game. Many agents will add labs in parallel, so registration
must not funnel through a shared file.

**Alternatives.**

- Central registry array: every new lab edits the same file (merge conflicts).
- React Router: more capability than needed; client-side navigation keeps old labs alive longer
  and hides cleanup bugs.
- A plugin framework (dynamic loading, lifecycle hooks): speculative.
- Storybook: a separate toolchain and component-centric model; labs need long-running loops and
  full subsystem composition.

**Rationale.** Folder discovery gives zero-conflict registration with compile-time types and
runtime validation (`buildLabIndex` rejects malformed labs). Full page loads make every lab URL
self-contained and guarantee teardown between labs.

**Consequences.** Labs must clean up on unmount themselves (StrictMode double-mounting in dev
surfaces leaks). Planned labs are listed in `labs/index.ts`, and an implemented lab supersedes its
planned entry automatically. Hosting the Studio statically needs an SPA fallback to `index.html`.
