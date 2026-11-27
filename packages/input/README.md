# @mortal-doctrine/input

**Layer:** `presentation` (browser device adapter) · **May depend on:** `sim-core` (for the
`InputFrame` contract) and lower layers.

Captures keyboard and gamepad state for one player and turns it into a raw `InputFrame` bitmask
(`@mortal-doctrine/sim-core`) once per simulation tick, without losing taps shorter than a tick.
Opposing directions are kept as pressed; the simulation resolves them.

**Non-goals:** gameplay interpretation (SOCD, motion inputs, charges, chords, buffering windows —
those are simulation concerns), UI keyboard shortcuts, rebinding UI and persisted settings (M6),
touch, rumble, right stick, analog triggers, `preventDefault` / page-scroll suppression.

## API

| Export                                   | Purpose                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createInputCapture(bindings, sources?)` | One capture per player. `sample()` → `InputFrame`, `inspect()` → `InputDiagnostics`, `dispose()`                |
| `PlayerBindings`                         | One player's device assignment and bindings: `keyboard` (`KeyBindings \| null`), `gamepadIndex`, `gamepad`      |
| `KeyBindings`                            | Every `InputBitName` → `KeyboardEvent.code` list (layout-independent)                                           |
| `GamepadBindings`                        | Every `InputBitName` → button indices, plus `stick` axis indices and `deadzone`                                 |
| `DEFAULT_PLAYER_BINDINGS`                | `[player 1, player 2]` defaults (below)                                                                         |
| `DEFAULT_GAMEPAD_BINDINGS`               | Standard-mapping pad defaults (below)                                                                           |
| `InputSources`                           | Where device state comes from: `window`, `document`, `getGamepads()`. Defaults to the browser; inject for tests |
| `GamepadLike`, `InputDiagnostics`        | The subset of `Gamepad` that is read; the shape `inspect()` returns                                             |

### Sampling

Call `sample()` exactly once per simulation tick (from the runner's input provider). It returns
everything held right now **plus every bound key pressed since the previous sample**, then clears
that latch. So a key pressed and released between two ticks sets its bit in exactly one frame, and
a held key stays set until the first sample after its `keyup`. Latches wait as long as it takes for
the next sample (for example while a lab is paused).

The assigned gamepad is polled inside `sample()`; there is no timer. Consequence: a pad press
shorter than one tick that falls entirely between two samples is missed.

`inspect()` is a read-only view for diagnostics (the Input Lab): held bound key codes, the `held`
frame (keyboard and pad, no latches), the pending `latched` frame, and the assigned pad's pressed
button indices and stick position (`null` when no pad is connected). It consumes nothing.

### Bindings and device assignment

Bindings are plain JSON-serializable data. A player is assigned a keyboard by giving it key
bindings (`keyboard: null` assigns none) and a gamepad by index into `navigator.getGamepads()`
(`gamepadIndex: null` assigns none). A player may have both; their bits are ORed. Give two players
disjoint key sets and different pad indices and they never affect each other.

Defaults (`DEFAULT_PLAYER_BINDINGS`):

|          | Directions (← → ↑ ↓)  | `A1`–`A6`             | Gamepad index |
| -------- | --------------------- | --------------------- | ------------- |
| Player 1 | Arrow keys or A D W S | U I O J K L           | 1             |
| Player 2 | Numpad 4 6 8 5        | Digit row 1 2 3 4 5 6 | 0             |

The first connected pad (index 0) drives player 2, so one keyboard plus one pad is a two-player
setup without configuration; a second pad drives player 1.

Gamepad (`DEFAULT_GAMEPAD_BINDINGS`, W3C standard mapping): d-pad buttons 14 / 15 / 12 / 13 for
left / right / up / down; `A1`–`A3` = X, Y, RB (2, 3, 5); `A4`–`A6` = A, B, RT (0, 1, 7); left
stick (axes 0 and 1) counts as a direction once an axis exceeds the `deadzone` of 0.5.

### Blur, visibility and disposal

Key-up events are lost while the page is unfocused or hidden, so `blur` on the window and
`visibilitychange` to `hidden` on the document release every held key and drop pending latches.
Gamepad state is not event-driven: a button that is still physically held is read again on the next
sample.

`dispose()` removes every listener the capture added and stops reading the gamepad source;
`sample()` returns `NEUTRAL_INPUT` from then on.

## Usage

```ts
import { createInputCapture, DEFAULT_PLAYER_BINDINGS } from '@mortal-doctrine/input';

const p1 = createInputCapture(DEFAULT_PLAYER_BINDINGS[0]);
const p2 = createInputCapture(DEFAULT_PLAYER_BINDINGS[1]);
runner.advance(elapsedMs, () => [p1.sample(), p2.sample()]);
// on teardown:
p1.dispose();
p2.dispose();
```

## Tests

`pnpm --filter @mortal-doctrine/input test` — runs in Node against plain `EventTarget`s and a fake
gamepad source. Browser behaviour is covered by `e2e/studio-input.spec.ts` in the Input Lab
(`/labs/input`).
