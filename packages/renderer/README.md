# @mortal-doctrine/renderer

**Layer:** `presentation` · **May depend on:** `simulation` (read-only state types and constants),
lower layers, `pixi.js`.

Draws simulation snapshots with PixiJS: placeholder arena floor and two fighter rectangles.
Owns the Pixi application, its ticker (display-rate frame callbacks) and frame diagnostics.

**Non-goals:** game logic, input, React, mutating simulation state. Skeletal rendering, effects
and camera belong to future packages.

## API

| Export                             | Purpose                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `createArenaRenderer(host)`        | Async; creates the Pixi app and appends a canvas (960×540 logical, CSS-scaled) to `host`      |
| `ArenaRenderer.render(state)`      | Draws a snapshot                                                                              |
| `ArenaRenderer.onFrame(cb)`        | Display-frame callback with elapsed ms; returns unsubscribe                                   |
| `ArenaRenderer.fps`, `.frameCpuMs` | Smoothed FPS; CPU ms of the previous frame (callbacks + scene + draw submission, no GPU time) |
| `ArenaRenderer.destroy()`          | Destroys the Pixi app and removes the canvas                                                  |

## Usage

```ts
import { createArenaRenderer } from '@mortal-doctrine/renderer';

const renderer = await createArenaRenderer(hostElement);
const stop = renderer.onFrame((elapsedMs) => {
  runner.advance(elapsedMs, inputs());
  renderer.render(runner.state);
});
// teardown:
stop();
renderer.destroy();
```

## Tests

Requires WebGL, so it is covered by Playwright (`e2e/`) through the game and the Simulation Lab
rather than Vitest.
