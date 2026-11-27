# @mortal-doctrine/input

**Layer:** `presentation` (browser device adapter) · **May depend on:** `simulation` (for the
`PlayerInput` contract) and lower layers.

Translates browser keyboard events into the simulation's per-tick `PlayerInput`.

**Non-goals:** gameplay interpretation (motion inputs, buffering, combos — those are simulation
concerns), UI keyboard shortcuts. Gamepads and press/release edge latching are not implemented
yet.

## API

| Export                                   | Purpose                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `createKeyboardInput(target, bindings?)` | Listens on any `EventTarget` (usually `window`); `read()` samples held keys; `dispose()` removes listeners |
| `DEFAULT_BINDINGS`                       | ← → and A / D, by `KeyboardEvent.code` (layout-independent)                                                |
| `KeyBindings`, `KeyboardInput`           | Types                                                                                                      |

All keys release on window `blur` to avoid stuck input.

**Known limitation:** input is sampled as held state once per display frame. A tap whose keydown
and keyup both land between two samples is lost.

## Usage

```ts
import { createKeyboardInput } from '@mortal-doctrine/input';

const keyboard = createKeyboardInput(window);
runner.advance(elapsedMs, [keyboard.read(), NEUTRAL_INPUT]);
// on teardown:
keyboard.dispose();
```

## Tests

`pnpm --filter @mortal-doctrine/input test` — runs in Node against a plain `EventTarget`.
