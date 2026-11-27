# @mortal-doctrine/input

**Layer:** `presentation` (browser device adapter) · **May depend on:** `sim-core` (for the
`InputFrame` contract) and lower layers.

Translates held browser keys into a raw per-tick `InputFrame` bitmask (`@mortal-doctrine/sim-core`).
Opposing directions are kept as pressed; the simulation resolves them.

**Non-goals:** gameplay interpretation (motion inputs, buffering, combos — those are simulation
concerns), UI keyboard shortcuts. Gamepads, tap latching, rebinding UI and `preventDefault`
handling are not implemented yet (M1.02).

## API

| Export                                   | Purpose                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `createKeyboardInput(target, bindings?)` | Listens on any `EventTarget` (usually `window`); `read()` returns the held keys as an `InputFrame`; `dispose()` removes listeners |
| `DEFAULT_BINDINGS`                       | `LEFT` ← / A, `RIGHT` → / D, `UP` ↑ / W, `DOWN` ↓ / S, `A1`–`A6` U I O J K L, by `KeyboardEvent.code` (layout-independent)        |
| `KeyBindings`, `KeyboardInput`           | `KeyBindings` maps every `InputBitName` to key codes                                                                              |

All keys release on window `blur` to avoid stuck input.

**Known limitation:** input is sampled as held state once per simulation tick. A tap whose keydown
and keyup both land between two samples is lost.

## Usage

```ts
import { createKeyboardInput } from '@mortal-doctrine/input';
import { NEUTRAL_INPUT } from '@mortal-doctrine/sim-core';

const keyboard = createKeyboardInput(window);
runner.advance(elapsedMs, () => [keyboard.read(), NEUTRAL_INPUT]);
// on teardown:
keyboard.dispose();
```

## Tests

`pnpm --filter @mortal-doctrine/input test` — runs in Node against a plain `EventTarget`.
