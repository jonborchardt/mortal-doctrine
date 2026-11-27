# 0005 — Layered workspace packages with enforced boundaries

**Status:** Accepted (M0)

**Decision.** Subsystems are pnpm workspace packages assigned to one of six layers (`foundation`,
`simulation`, `animation`, `presentation`, `content`, `application`), declared in `package.json`.
A dependency-free script (`pnpm check:boundaries`) and ESLint enforce layering, acyclicity,
declared imports and public entry points as part of `pnpm check`. Packages export TypeScript
source; there is no package build step.

**Context.** Many agents will develop subsystems in parallel worktrees. Boundaries must be
checked mechanically, not by review, and the setup must stay small.

**Alternatives.**

- dependency-cruiser: capable, but another configuration language and dependency for rules that
  fit in ~200 lines of tested TypeScript over `package.json` files.
- Nx / Turborepo module boundaries: bring a build-orchestration framework we do not need.
- A single package with folder conventions: no enforcement of dependency direction or declared
  dependencies.
- TypeScript project references: enforce reference direction but require emitting declarations.

**Rationale.** pnpm's strict `node_modules` already makes undeclared dependencies fail to resolve;
the script adds layer direction, cycle detection, naming and content independence; ESLint adds
file-level import rules. All of it is small, readable and runs everywhere Node runs.

**Consequences.** Every package needs a `layer` field, `exports` and a README. New
simulation-layer packages need the determinism ESLint block. The import scanner is regex-based;
exotic syntax (computed dynamic imports) is not detected — keep imports static.
