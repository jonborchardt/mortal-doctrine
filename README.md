# Mortal Doctrine

A browser-native 2D fighting game starring satirical personifications of the world's major
religions, each with a distinctive fighting style and supernatural abilities. The long-term goal
is combat depth comparable to traditional competitive fighters: deterministic frame-accurate
simulation, asymmetric character mechanics and expressive skeletal animation.

**Status: M0 (foundation).** The repository contains the architecture, tooling and a hello-world
slice: two placeholder fighters, one keyboard-controlled, on a fixed-step simulation rendered
by PixiJS, plus a Studio with a Simulation Lab. No combat, characters or animation exist yet.
See [docs/roadmap.md](docs/roadmap.md).

## Quick start

Requires Node.js 24 and Corepack (bundled with Node 24).

```sh
corepack enable
pnpm install
pnpm dev          # game on http://localhost:5173, Studio on http://localhost:5174
```

Studio labs have direct URLs, e.g. http://localhost:5174/labs/simulation.

## Commands

| Command                                | Purpose                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev` / `dev:game` / `dev:studio` | Vite dev servers (both / game / Studio)                                  |
| `pnpm build`                           | Production builds of both apps (`apps/*/dist`)                           |
| `pnpm typecheck`                       | `tsc` for the root project and every workspace package                   |
| `pnpm lint`                            | ESLint (includes layer/determinism import rules)                         |
| `pnpm format` / `format:check`         | Prettier write / verify                                                  |
| `pnpm check:boundaries`                | Workspace dependency-layer verification                                  |
| `pnpm test`                            | Vitest unit and integration tests (Node, headless)                       |
| `pnpm test:e2e`                        | Playwright browser tests (starts its own isolated servers)               |
| `pnpm bench`                           | Headless simulation benchmarks                                           |
| `pnpm check`                           | All non-browser gates: format, lint, typecheck, boundaries, tests, build |
| `pnpm check:all`                       | `check` + browser tests (what CI runs)                                   |

## Repository layout

```text
apps/game        playable game (composition only)
apps/studio      development labs (composition only)
packages/*       engine subsystems: sim-core, simulation, input, renderer (more arrive in M1)
characters/*     one package per fighter (none yet)
arenas/*         one package per stage (none yet)
scripts/         repository tooling (dependency-boundary checker)
e2e/             Playwright tests
docs/            architecture, conventions, decisions, roadmap
```

## Documentation

- [Architecture](docs/architecture.md) — layers, boundaries, simulation and event rules
- [Development](docs/development.md) — workflows for packages, labs, characters; diagnostics
- [Testing](docs/testing.md) · [Build system](docs/build-system.md)
- [Content conventions](docs/content-conventions.md) — identifiers, coordinates, assets
- [Roadmap](docs/roadmap.md) · [Decision records](docs/decisions/)
- [CLAUDE.md](CLAUDE.md) — mandatory engineering rules for agents and humans
