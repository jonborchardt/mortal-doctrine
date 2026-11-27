# Content conventions

Defaults for content that does not exist yet. Items marked **(implemented)** are already true in
code; everything else is the binding convention for the first ticket that needs it. Change a
convention deliberately, in this file, in the same change that needs it.

## Identifiers

All identifiers are lowercase ASCII kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`), stable once shipped
(they appear in saves, replays and asset paths), and never contain display text.

| Kind       | Form                                                                                                                            | Example                            | Unique within |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------- |
| Character  | `<character>`                                                                                                                   | `monk`                             | game          |
| Arena      | x ∈ [0, 96000] sub-units (960 world units) today **(implemented)**; arenas will define their own width; camera handles framing. |
| Move       | `<move>`; qualified `<character>/<move>`                                                                                        | `palm-strike`, `monk/palm-strike`  | character     |
| Animation  | `<animation>`; qualified `<character>/<animation>`                                                                              | `idle`, `monk/walk-forward`        | character     |
| Bone       | `<bone>`                                                                                                                        | `forearm-left`, `wing-right-2`     | rig           |
| Attachment | `<attachment>`                                                                                                                  | `robe-torso`, `halo`               | rig           |
| Effect     | `<owner>/<effect>`, owner = `core` or a character id                                                                            | `core/hit-spark`, `monk/chi-burst` | game          |
| Studio lab | `<lab>` **(implemented)**                                                                                                       | `simulation`                       | Studio        |

Packages: `@mortal-doctrine/character-<id>` in `characters/<id>/`,
`@mortal-doctrine/arena-<id>` in `arenas/<id>/` **(implemented in the boundary checker)**.

## Coordinates and units

| Topic            | Convention                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World unit       | 1 unit = 1 logical pixel at the reference viewport. **(implemented)**                                                                                                                                                                                                              |
| Sub-units        | `SUBUNITS_PER_UNIT = 100` integer sub-units per world unit, defined once in `@mortal-doctrine/sim-core`. Positions, sizes and distances are sub-units; velocities sub-units per frame; accelerations sub-units per frame². **(implemented)**                                       |
| Numeric type     | Integers only; simulation state never stores a float. Every stored value is in the signed 32-bit range [−2,147,483,648, 2,147,483,647] sub-units (about ±21.4 million world units), enforced by the state schema. **(implemented)**                                                |
| Intermediates    | Products and other intermediates must stay within `Number.MAX_SAFE_INTEGER`; the checked helpers (`scaleRatio`) throw a descriptive error rather than return an inexact value. **(implemented)**                                                                                   |
| Rounding         | Division and ratio scaling (`divTrunc`, `scaleRatio`) truncate toward zero, so `f(−x) === −f(x)` and mirrored fighters behave identically. Friction is `decelerate` (clamped at zero) or a bounded `scaleRatio`; acceleration and gravity are integer additions. **(implemented)** |
| Gameplay axes    | +x right; +y **up**; y = 0 is the ground line. **(implemented: fighter x, y in `@mortal-doctrine/movement`)**                                                                                                                                                                      |
| Screen axes      | Pixi/screen: +y **down**. Conversion happens only in presentation: `screenY = groundY − y`.                                                                                                                                                                                        |
| Arena            | Gameplay bounds are arena rules `{ width, maxSeparation? }` in simulation state (default width 96000 sub-units = 960 units): pushbox edges stay in [0, width] **(implemented)**. Arenas will supply their own rules; camera handles framing.                                       |
| Facing           | `facing: 1` (right) or `-1` (left), stored per fighter; grounded fighters turn toward the opponent, airborne ones keep their facing **(implemented)**. All content is authored facing right; presentation and hit geometry mirror by `facing`.                                     |
| Character origin | Ground contact point, horizontally centered between the feet (bottom-center of the pushbox). **(implemented for placeholders)**                                                                                                                                                    |
| Angles           | Degrees in authored content files; radians at runtime. Convert once in the loader. Positive = counter-clockwise in gameplay space (y-up). **(implemented in `@mortal-doctrine/math`)**                                                                                             |
| Logical viewport | Default 960 × 540 (16:9), configurable per renderer (`width`, `height`) **(implemented)**, scaled to the canvas host by CSS. A default, not a constraint: never assume it equals the arena width.                                                                                  |
| Rendering scale  | Default: textures authored at 2× the logical resolution for high-DPI displays; loaded at resolution 2 so a 192 px file is 96 logical px. Configurable per manifest load (`loadTextureManifest(url, { resolution })`) **(implemented)**.                                            |
| Gameplay time    | Integer frames at 60 Hz **(implemented)**. Move frame data (startup/active/recovery) is in frames.                                                                                                                                                                                 |
| Animation time   | Keyframe times in integer frames at 60 Hz; presentation may interpolate between them and between ticks. Animation never drives gameplay timing.                                                                                                                                    |

## Skeletons are per-character

There is no universal humanoid skeleton. A rig declares its own bones, hierarchy and attachment
slots. Engine code may rely only on a small set of declared **anchors** (e.g. `root`, plus
whatever named points the combat system later needs, such as projectile spawn points) — not on a
fixed bone list. Extra arms, wings, summoned entities and attachments that change at runtime are
expected.

## Data versus assets

- Gameplay data (stats, frame data, hitboxes, move properties) lives in TypeScript or JSON
  definitions validated by Zod schemas — never inside images, rig exports or animation curves.
- Visual assets (textures, atlases) live in files referenced by manifest, never inlined into
  TypeScript (small test fixtures excepted).
- Replacing art must not require engine changes.

## Asset manifests

**(implemented: `loadTextureManifest` / `parseTextureManifest` in `@mortal-doctrine/renderer`)**

Each content package keeps assets in `assets/` with an `assets/manifest.json`:

```json
{
  "schemaVersion": 1,
  "textures": { "robe-torso": "textures/robe-torso@2x.png" }
}
```

- Paths are relative to the manifest, forward slashes, no `..`.
- Texture files: `<attachment-or-name>@2x.png`, kebab-case.
- Every content file (manifest, rig, animation set, move list) has an integer `schemaVersion`;
  loaders validate with the Zod schema for that version and reject unknown versions.
