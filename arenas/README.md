# arenas/

One workspace package per stage: `arenas/<id>/`, named `@mortal-doctrine/arena-<id>`, layer
`content`. One exists: [`training-hall`](training-hall/README.md), not yet wired into any app
(the game draws the placeholder arena).

Rules (enforced by `pnpm check:boundaries`): depend only on public engine entry points; never on a
character or another arena. See [docs/content-conventions.md](../docs/content-conventions.md).
