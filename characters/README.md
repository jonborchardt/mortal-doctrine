# characters/

One workspace package per fighter: `characters/<id>/`, named `@mortal-doctrine/character-<id>`,
layer `content`. None exist yet (first fighters arrive in M3–M4).

Rules (enforced by `pnpm check:boundaries`): depend only on public engine entry points; never on
another character or an arena. See [docs/development.md](../docs/development.md#adding-a-character-intended-workflow)
and [docs/content-conventions.md](../docs/content-conventions.md).
