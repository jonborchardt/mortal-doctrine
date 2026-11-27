# Content conventions

Defaults for content that does not exist yet. Items marked **(implemented)** are already true in
code; everything else is the binding convention for the first ticket that needs it. Change a
convention deliberately, in this file, in the same change that needs it.

## Identifiers

All identifiers are lowercase ASCII kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`), stable once shipped
(they appear in saves, replays and asset paths), and never contain display text.

| Kind       | Form                                                 | Example                            | Unique within |
| ---------- | ---------------------------------------------------- | ---------------------------------- | ------------- |
| Character  | `<character>`                                        | `monk`                             | game          |
| Arena      | `<arena>`                                            | `temple-steps`                     | game          |
| Move       | `<move>`; qualified `<character>/<move>`             | `palm-strike`, `monk/palm-strike`  | character     |
| Animation  | `<animation>`; qualified `<character>/<animation>`   | `idle`, `monk/walk-forward`        | character     |
| Bone       | `<bone>`                                             | `forearm-left`, `wing-right-2`     | rig           |
| Attachment | `<attachment>`                                       | `robe-torso`, `halo`               | rig           |
| Effect     | `<owner>/<effect>`, owner = `core` or a character id | `core/hit-spark`, `monk/chi-burst` | game          |
| Studio lab | `<lab>` **(implemented)**                            | `simulation`                       | Studio        |

Packages: `@mortal-doctrine/character-<id>` in `characters/<id>/`,
`@mortal-doctrine/arena-<id>` in `arenas/<id>/` **(implemented in the boundary checker)**.

## Coordinates and units

| Topic            | Convention                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| World unit       | 1 unit = 1 logical pixel at the reference viewport. **(implemented)**                                                                           |
| Numeric type     | Gameplay positions and velocities are integers **(implemented)**; sub-unit precision is an explicit M1 decision.                                |
| Gameplay axes    | +x right; +y **up**; y = 0 is the ground line. (Only x exists today.)                                                                           |
| Screen axes      | Pixi/screen: +y **down**. Conversion happens only in presentation: `screenY = groundY − y`.                                                     |
| Arena            | x ∈ [0, 960] today **(implemented)**; arenas will define their own width; camera handles framing.                                               |
| Facing           | `facing: 1` (right) or `-1` (left). All content is authored facing right; presentation and hit geometry mirror by `facing`.                     |
| Character origin | Ground contact point, horizontally centered between the feet (bottom-center of the pushbox). **(implemented for placeholders)**                 |
| Angles           | Degrees in authored content files; radians at runtime. Convert once in the loader. Positive = counter-clockwise in gameplay space (y-up).       |
| Logical viewport | 960 × 540 (16:9) **(implemented)**, scaled to the canvas host by CSS.                                                                           |
| Rendering scale  | Textures authored at 2× logical resolution for high-DPI displays.                                                                               |
| Gameplay time    | Integer frames at 60 Hz **(implemented)**. Move frame data (startup/active/recovery) is in frames.                                              |
| Animation time   | Keyframe times in integer frames at 60 Hz; presentation may interpolate between them and between ticks. Animation never drives gameplay timing. |

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
