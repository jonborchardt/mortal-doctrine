# @mortal-doctrine/commands

**Layer:** `simulation` · **May depend on:** `sim-core`, `zod`.

Deterministic gameplay command recognition from input history: motions, charges, chords and
button presses or releases with frame windows, relative to facing. It owns the declarative
definition format, the `commands` slice of `SimulationState` and its pure update.
`@mortal-doctrine/simulation` calls it as one phase of `step`.

**Non-goals:** what commands do (moves, cancels, buffering, consumption: M2), device capture
(`@mortal-doctrine/input`), facing itself (the caller passes it), per-player lists, any
character-specific command list.

## Definitions

```ts
{
  id: string;                        // unique within a list
  motion?: Direction[];              // 1+ of neutral, forward, back, up, down, up-forward,
                                     // up-back, down-forward, down-back
  charge?: { direction: 'forward' | 'back' | 'up' | 'down'; frames: number };
  trigger: { buttons: ('A1' | … | 'A6')[]; edge: 'press' | 'release'; chordWindow: number };
  maxFrames: number;
}
```

Strict (unknown keys rejected); all numbers int32. `maxFrames` and `charge.frames` are positive,
`chordWindow` is non-negative. Buttons are unique; a `release` trigger has exactly one.

Matching for one player on the frame being processed (`frame`):

- **Directions** come only from `resolveDirection`; `forward` is toward the player's facing.
- **Trigger.** A command fires only on the frame its trigger edge occurs. `press`: every button
  is held now, at least one was pressed this frame, and every button's current hold started at
  most `chordWindow` frames ago (0 = same frame; single buttons need a press this frame).
  `release`: the button was held on the previous frame and is not held now (negative edge).
- **Motion.** The steps occur in order, each an exact direction, not necessarily adjacent, among
  the last `maxFrames` frames, current frame included.
- **Charge.** A frame holds a cardinal when its relative direction contains it (back is satisfied
  by down-back). The charge qualifies when `frames` consecutive held frames have occurred and the
  last frame of that run is at most `maxFrames` frames before the trigger frame (0 = still held).
  So `frames - 1` held frames reject and `frames` recognize.
- `maxFrames` is unused by definitions with neither motion nor charge.

**Priority.** Events are ordered by player index, then definition list order (earliest first).
Nothing is consumed or suppressed: several commands can fire on one frame.

**History.** A definition reads `requiredHistory(definition)` =
`max(maxFrames, (chord ? chordWindow : 0) + 2)` history frames; `createCommandsSlice` throws when
that exceeds the history capacity. A charge's `frames` does not count: charges are tracked in the
slice, so they can exceed the history.

## API

| Export                                                              | Purpose                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `commandDefinitionSchema`, `commandListSchema`, `CommandDefinition` | Zod schemas (the list also rejects duplicate ids) and the type                                         |
| `directionSchema`, `buttonSchema`, `Direction`, `Button`            | The step and button vocabularies                                                                       |
| `parseCommandList(value)`                                           | Returns the list or throws a `TypeError` naming every failing path (`commands.0.trigger.buttons: …`)   |
| `requiredHistory(definition)`                                       | History frames the definition reads                                                                    |
| `createCommandsSlice(definitions, historyCapacity)`                 | Validates and builds the initial slice; throws on invalid definitions or insufficient capacity         |
| `commandsSliceSchema`, `CommandsSlice`                              | `{ definitions, charges: [p1, p2] }`; one `{ run, since }` counter per charge definition, else `null`  |
| `updateCommands(slice, context)`, `CommandsContext`, `Facing`       | Pure: `{ slice, events }` for `{ frame, histories, facing }`; histories already hold the current frame |
| `CommandEvent`                                                      | `{ type: 'command', frame, player: 0 \| 1, command: id }`, frozen                                      |

`@mortal-doctrine/commands/testing` exports generic definitions (`QUARTER_CIRCLE`,
`DRAGON_PUNCH`, `HALF_CIRCLE`, `SPIN` (360), `CHARGE`, `CHORD`, `SAME_FRAME_CHORD`, `RELEASE`,
`GENERIC_COMMANDS`), `MOTION_CASES` and `spanned` for window boundary tables, `mirror` (swaps
LEFT/RIGHT), `soloInputs`, `COMMAND_SCRIPTS` and `commandCycleScript` (both-player inputs for
`GENERIC_COMMANDS`), and `startRun` / `advanceRun`, a minimal recognizer harness.

## Usage

```ts
import { createInitialState, step } from '@mortal-doctrine/simulation';

const state = createInitialState({
  commands: [
    {
      id: 'fireball',
      motion: ['down', 'down-forward', 'forward'],
      trigger: { buttons: ['A1'], edge: 'press', chordWindow: 0 },
      maxFrames: 12,
    },
  ],
});
const { events } = step(state, inputs); // [{ type: 'command', frame, player, command: 'fireball' }]
```

## Tests

`pnpm --filter @mortal-doctrine/commands test`: table-driven motion windows (±1, both facings,
unmirrored input rejected), charge duration, release gap, capacity and restore, chord windows,
release, priority, schema rejections with paths, determinism. Integration through `step` is
tested in `@mortal-doctrine/simulation`.
