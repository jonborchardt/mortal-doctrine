---
name: verify-implementation
description: Use before declaring any Mortal Doctrine ticket or change complete — checks acceptance criteria, runs focused tests then the full quality gates and browser tests, inspects the diff, and reports results and limitations honestly.
---

# Verify an implementation

## 1. Acceptance criteria

Re-read the ticket. For each criterion, name the test, command output or screenshot that proves
it. A criterion without evidence is not done. Note anything implemented beyond scope and remove it
unless the ticket requires it.

## 2. Focused checks first

- `pnpm --filter @mortal-doctrine/<pkg> test` for touched packages.
- `pnpm test:e2e --project <game|studio>` or a single spec file for touched UI.

## 3. Full gates

```sh
pnpm check       # format:check, lint, typecheck, check:boundaries, test, build
pnpm test:e2e    # whenever anything browser-facing changed (CI always runs it)
```

If formatting fails, run `pnpm format` and review what it changed. Any other failure is a defect:
find the cause. Never weaken a gate (see CLAUDE.md). If an unrelated pre-existing failure blocks
you, confirm it also fails on the base commit and report it with the exact command and output.

## 4. Behavioral evidence

- **Simulation changes:** scripted-input tests showing the new behavior frame by frame, plus
  determinism (same inputs ⇒ same serialized state) and serialize/restore equivalence.
- **Visual or interactive changes:** a Playwright spec that exercises the change, plus
  screenshots (lab URL at a known fixture state; before/after for changed visuals) saved outside
  the repository or deleted afterward. Check the browser console for errors.
- **Resource-owning components:** a test proving teardown (e.g. exactly one canvas after
  StrictMode remount, listeners removed after `dispose`).
- **Public API changes:** every consumer still builds and passes (`pnpm check` covers the
  workspace); name the consumers in the report.
- Prefer Playwright-managed servers. Do not leave `pnpm dev` running in the background: on
  Windows, killing the parent leaves `vite` children behind (`docs/development.md`).

## 5. Inspect the diff

`git status` and `git diff`: no stray files (screenshots, logs, `.only`), no unrelated formatting
or refactors, no new dependency without a reason, no root-config or shared-contract change that
is not called out, no edits to unrelated packages, no work belonging to a downstream ticket, docs
updated where behavior or conventions changed. Ensure no dev servers or other processes you
started are still running (on Windows, check for leftover `node … vite` processes).

## 6. Report

State what changed, the verification commands and their results (real output, including failures),
evidence per acceptance criterion, known limitations, and recommended follow-up tickets for
missing prerequisites.
