# @mortal-doctrine/arena-training-hall

**Layer:** `content` · **May depend on:** `arena` (`Arena` type), `movement` (`ArenaRules` type).
Tests also use `renderer` (`parseTextureManifest`), `simulation` (`createInitialState`) and Node
`fs` to read the package's own assets.

The Training Hall arena: one definition holding both the gameplay arena rules a match is created
with and the presentation data drawn for it. The package's tests are the consistency check
between the two halves.

**Non-goals:** wiring into `apps/game`, `match-view`, the Studio labs or the M2 sandbox, and
serving `assets/` to the browser (a separate ticket; the game still draws the placeholder arena);
real art, stage hazards, foreground layers; an arena registry or selection; a shared engine
`ArenaDefinition` type or checker.

## API

| Export                   | Meaning                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TRAINING_HALL`          | `{ rules, arena }`. Pass `rules` as `createInitialState({ arena })`; `arena` to `createArenaRenderable`, its bounds to the camera. |
| `TrainingHallDefinition` | The definition's type: `{ readonly rules: ArenaRules; readonly arena: Arena }`.                                                    |

## Values

| Field                 | Value                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| `rules.width`         | 96000 sub-units (equal to `DEFAULT_ARENA_RULES`, so replay works; #216) |
| `rules.maxSeparation` | none                                                                    |
| `arena.id`            | `training-hall`                                                         |
| `arena.groundLine`    | 10000                                                                   |
| `arena.visualBounds`  | −4000 … 100000 (centre 48000 = `width / 2`)                             |
| `arena.layers`        | `sky` 0, `far` 0.25, `mid` 0.5, `ground` 1 (back to front)              |

Textures (`assets/manifest.json`, flat-colour placeholders copied from the Studio arena fixture):
`sun`, `far-tower`, `mid-block`, `ground`, `ground-post`.

## Consistency checks (`tests/`)

Rules pass `arenaRulesSchema` and the presentation data passes `parseArena` unchanged; visual
bounds contain `[0, width]` and are centred on it; the front-most layer has parallax 1; a match
created with `rules` carries them; every layer texture id is in the manifest and every manifest
path exists under `assets/`.
