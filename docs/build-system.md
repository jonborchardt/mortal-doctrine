# Build system

## Toolchain pins

| What             | Where                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| Node 24          | `.nvmrc`, `engines` in `package.json`; `engineStrict: true` in `pnpm-workspace.yaml` |
| pnpm 12.23.0     | `packageManager` in `package.json` (via Corepack)                                    |
| Dependencies     | `pnpm-lock.yaml` (committed; CI installs with `--frozen-lockfile`)                   |
| TypeScript 6.0.x | `~6.0.3`: typescript-eslint does not yet support TypeScript 7                        |

pnpm's default supply-chain policy rejects versions published within its minimum release age.
Do not bypass it with `minimumReleaseAgeExclude`; pick the previous release. Dependency
permissions (build scripts, agent skills) are decided in `pnpm-workspace.yaml`; pixi.js's offer
to install agent skills is denied.

## Lockfile conflicts

Parallel tickets that add dependencies will conflict in `pnpm-lock.yaml`. Resolve it this way:

1. Resolve every conflicting `package.json` by hand so it keeps **both** sides' dependency
   changes, unless one side's removal was intentional and is called out in the summary.
2. Discard both sides of the lockfile conflict (`git checkout --theirs pnpm-lock.yaml` or
   `--ours`, either is fine; it will be regenerated), then regenerate it from the merged
   manifests with the pinned pnpm: `pnpm install` (Corepack uses `packageManager`, so it is
   12.23.0; check with `pnpm --version`).
3. Verify: `pnpm install --frozen-lockfile` must succeed with no changes, then run `pnpm check`.
4. In the summary, list the dependency changes that came from each side.

Never hand-edit the lockfile, never resolve it by keeping one side's file as final, and never
silently drop a dependency change.

## How it fits together

- **No package build step.** Workspace packages export TypeScript source
  (`"exports": { ".": "./src/index.ts" }`); Vite bundles it for the apps and Vitest runs it
  directly. Nothing is emitted inside `packages/`.
- **Type checking** is `tsc --noEmit` per package (`pnpm -r typecheck`) plus the root project
  (configs, scripts, e2e). Each package's `tsconfig.json` selects the libs its layer may use.
- **App builds** write only to `apps/<app>/dist/` (git-ignored). Vitest and Playwright write to
  `node_modules/.vite`, `test-results/` and `playwright-report/` (git-ignored, per checkout).
- **Orchestration** is pnpm itself (`--filter`, `-r`, `--parallel`). No Nx/Turborepo: the
  workspace is small and source-only packages have nothing to cache.
- **Scripts** are cross-platform: pnpm commands joined by `&&` (works in cmd, PowerShell and sh);
  repository tooling is TypeScript run by Node 24's built-in type stripping
  (`node scripts/check-boundaries.ts`, erasable syntax only, no dependencies).

## Quality gates

`pnpm check` = `format:check` → `lint` → `typecheck` → `check:boundaries` → `test` → `build`,
stopping at the first failure with a nonzero exit code. None of these modify files; `pnpm format`
is the only writing command. Browser tests are separate (`pnpm test:e2e`) because they launch
Chromium and dev servers; `pnpm check:all` runs both and is what CI runs.

## Branch protection (GitHub)

`main` requires a pull request (zero approvals), the status checks `verify (ubuntu-latest)` and
`verify (windows-latest)` from GitHub Actions, and an up-to-date branch. It applies to admins too,
and forbids force pushes, deletion and nothing else (merge commits are allowed; no linear
history). This matches orch, which merges with `gh pr merge --merge --match-head-commit` and
never `--admin`. **If the CI matrix or job name changes, the required check names must be updated
in the branch protection rule in the same change**, or every PR will wait forever.

## Worktree isolation

- Nothing references absolute paths, the home directory or machine-global temp files.
- Each checkout has its own `node_modules` (pnpm hard-links from the shared content-addressed
  store, which is safe to share) and its own build/test output directories.
- Playwright picks two free ports per run, starts its own Vite servers
  (`reuseExistingServer: false`, `--strictPort`) and shuts them down afterward, so parallel
  worktrees never test each other's servers. Ports are handed to workers via `MD_E2E_GAME_PORT` / `MD_E2E_STUDIO_PORT`;
  setting them yourself pins the ports.
- No environment variables are required. `CI` only changes reporting and `forbidOnly`.
