# @mortal-doctrine/match-view

**Layer:** `presentation` · **May depend on:** `renderer`, `skeleton-renderer`, `arena`, `effects`,
`camera` (the systems it composes), `simulation`, `movement`, `animation`, `rig` (types only);
`./testing` also uses `audio`, `commands` and the other packages' `./testing` fixtures.

The match as it is shown: the one composition of the M1 presentation systems, used by
`apps/game` and by the Studio Integration Lab (`/labs/integration`, this package's lab). It fixes
the order of a display frame: per-tick capture → `step` → camera and audio per tick → one draw
through the camera's view. It names no rig, arena, cue or effect: callers pass them in. The
placeholder match (mannequins, placeholder arena, tone cues) is the `./testing` fixture.

**Non-goals:** owning the simulation runner, input capture or the audio player (the app creates
them); recording, playback, pause and step (Integration Lab); an animation state machine (the
pose function is the caller's); HUD; content. It adds no options for the open engine gaps
(#220 to #223): their workarounds live here once, as they were in the lab.

## API

| Export                                                            | Meaning                                                                                                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTickSource(getState, inputs)`                              | Splits a runner batch into ticks. Give `source.inputs` to the runner; `source.run(() => runner.advance(ms, source.inputs).events)` returns `Tick[]`.                                    |
| `Tick`                                                            | `{ state, events }`: the snapshot after one tick and the events it emitted (an event's `frame` is the frame its tick started from).                                                     |
| `createPresenter({ camera, initial, pose, audio, draw })`         | One timeline's presentation. `present(state, ticks)` returns the camera output.                                                                                                         |
| `DrawFrame`                                                       | What `draw` receives: `{ state, events, view, poses }`, with the events of every tick since the previous draw.                                                                          |
| `mountMatchStage(host, options)`                                  | Builds the Pixi stage in `host`. Returns `{ ready, dispose }` at once; `ready` resolves to the `MatchStage`, or `undefined` when disposed first.                                        |
| `MatchStage`                                                      | `{ renderer, effects, draw }`. `draw(frame)` sets the view and both fighters' poses, then renders. Pass it to `createPresenter`.                                                        |
| `SEED`, `SESSION_OPTIONS`, `ARENA`, `CAMERA_CONFIG` (`./testing`) | The placeholder match: seeded initial-state options with the generic commands, the parsed placeholder arena, the camera config bounded by it, with headroom for the airborne mannequin. |
| `fighterActivity`, `fighterPose` (`./testing`)                    | Placeholder movement-state names (`idle`, `walk`, `crouch`, `air`) and the state-to-clip pose mapping.                                                                                  |
| `PRESENTATION`, `STAGE`, `toneAudio(context)` (`./testing`)       | Ready-made options for `createPresenter` (add `audio`, `draw`), `mountMatchStage`, and `createAudioPlayer` (add `gestureTarget`).                                                       |

## Rules

**Presenter.** For each tick in order, the camera is updated with the tick's snapshot and events
and `audio.play` receives the tick's events; then `draw` is called once. The camera therefore
sees every tick, so its output does not depend on how ticks are batched into display frames.
The camera is first updated with `initial`, so its path does not depend on which snapshot is
drawn first. `present(state, [])` redraws: the same frame again returns the camera's last
output. A presenter is one timeline; create a new one when the simulation restarts.

**Stage.** The renderer is created without placeholders. The arena renderable owns the arena
manifest's textures. Both skeletons draw from one manifest, loaded once per skeleton: each
renderable owns its own handle, and the textures are unloaded when the last one is released.
`dispose()` destroys the renderer, which destroys every renderable and releases the textures.

**Mount queue.** Mounts are queued in this module, so a stage being torn down and the one
replacing it never interleave: a mount starts building only after the previous mount finished building (or gave up) and
every texture release it started has finished. A mount disposed while waiting builds nothing; one
disposed while loading registers nothing further on a live renderer and releases what it loaded.
This is what makes a React StrictMode mount, unmount and remount safe; callers keep no chain of
their own. If loading fails, `ready` rejects and `dispose()` still releases the renderer.

## Usage

```ts
import { createPresenter, createTickSource, mountMatchStage } from '@mortal-doctrine/match-view';

const mount = mountMatchStage(host, stageOptions);
const stage = await mount.ready;
if (stage) {
  const runner = createSimulationRunner(sessionOptions);
  const ticks = createTickSource(
    () => runner.state,
    () => [p1.sample(), p2.sample()],
  );
  const presenter = createPresenter({ camera, initial, pose, audio, draw: stage.draw });
  stage.renderer.onFrame((elapsedMs) => {
    const advanced = ticks.run(() => runner.advance(elapsedMs, ticks.inputs).events);
    stage.effects.advance(elapsedMs);
    presenter.present(runner.state, advanced);
  });
}
// Later: dispose what you created (captures, audio player), then
mount.dispose();
```

## Testing and integration

- Node tests (`tests/match-view.test.ts`) cover the presenter order, batch independence of the
  camera and the tick split. The stage needs WebGL: its build, release and remount are covered in
  the browser by `e2e/game.spec.ts` and `e2e/studio-integration.spec.ts`.
- **Used by** `apps/game` (`src/match.ts`, with the `./testing` fixture until content packages
  exist, #226) and the Integration Lab, whose Node tests
  (`apps/studio/tests/integration-*.test.ts`) run the presenter and the fixture headless.
