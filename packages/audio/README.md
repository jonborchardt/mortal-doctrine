# @mortal-doctrine/audio

**Layer:** `presentation` · **May depend on:** `sim-core` (`SimulationEventEnvelope`), `zod`.

Plays sound cues from simulation events through a small Web Audio mixer, safely under rewinds
and replays: a data-defined cue registry plus an event-consuming audio player with SFX, voice
and music buses.

**Non-goals:** music systems or adaptive music, spatial or panned audio, settings persistence,
production sounds, queueing events that arrive while locked, matching on event fields other than
`type`, wiring into `apps/game` (M1.18). It never writes simulation state.

## API

| Export                                                         | Meaning                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `createAudioPlayer({ context, cues, buffers, gestureTarget })` | Builds the player. Validates `cues` and throws `Cue "<id>" names sound "<sound>", which has no buffer` for a variation without a buffer. |
| `player.play(events)`                                          | Triggers the cue bound to each new event's `type`, once per event identity. Dropped while `locked` or `disposed`.                        |
| `player.state`                                                 | `'locked'` until the first `pointerdown`/`keydown` on `gestureTarget`, then `'unlocked'`; `'disposed'` after `dispose()`.                |
| `player.setVolume(bus, 0..1)` / `player.setMuted(bus, bool)`   | Set the bus gain immediately (clamped to 0..1). Muted gain is 0; unmuting restores the last volume. `player.bus(bus)` reads both.        |
| `player.voices`                                                | Playing voices `{ cue, bus }`, oldest first; a voice leaves when its source ends.                                                        |
| `player.log`                                                   | Triggered cues `{ frame, type, cue, variation }`, oldest first, last `TRIGGERED_LOG_LIMIT` (64).                                         |
| `player.dispose()`                                             | Stops voices, removes gesture and `ended` listeners, closes the context. Idempotent.                                                     |
| `parseCueRegistry(json)`                                       | Validates `CueDefinition[]` `{ id, bus: 'sfx'\|'voice'\|'music', variations: soundId[], events: type[] }`; rejects duplicate ids.        |
| `parseSoundManifest(json, manifestUrl)`                        | Validates `{ schemaVersion: 1, sounds: { id: path } }` (relative, forward slashes, no `..`) and returns id → absolute URL.               |
| `loadSoundManifest(manifestUrl, { fetch, context })`           | Fetches the manifest and every sound, decodes with `context.decodeAudioData`; buffers keyed by sound id. Failures name the id and URL.   |
| `AUDIO_BUSES`, `DEDUPE_WINDOW_FRAMES`, `AudioContextLike`      | Bus names, the dedupe window, and the Web Audio subset the player needs (a real `AudioContext` satisfies it).                            |

The player owns the context it is given: `dispose()` closes it. Errors name the offending field
(`1.bus`, `4.id: duplicate cue id "jump"`, `sounds.hit: must not contain ".."`).

## Event identity and dedupe

An event's identity is its frame, type and every other field, plus its occurrence index among
identical events in the same `play` call (the simulation's event order is deterministic). An
identity already played is never played again, so feeding the same events after a restore,
seek or replay is silent. Keys whose frame is more than **`DEDUPE_WINDOW_FRAMES` (600, 10 s)**
before the newest frame seen are forgotten; a rewind further back than that replays its cues.

The variation of a multi-variation cue is a hash of the cue id and the event identity: the same
event always picks the same sound. No `Math.random`.

Events that arrive while `locked` are dropped and not remembered, so stale SFX never burst out
on unlock.

## Usage

```ts
import { createAudioPlayer, loadSoundManifest, parseCueRegistry } from '@mortal-doctrine/audio';

const context = new AudioContext();
const buffers = await loadSoundManifest(new URL('audio/manifest.json', location.href).href, {
  fetch,
  context,
});
const player = createAudioPlayer({
  context,
  cues: parseCueRegistry(cueJson),
  buffers,
  gestureTarget: window,
});
// each display frame:
player.play(events); // the simulation events of the ticks just run
// teardown:
player.dispose();
```

## Integration points

- **Consumes** simulation event arrays (`SimulationEventEnvelope` / `SimulationEvent`), e.g. the
  runner's `advance(...).events` or the renderer's `RenderFrame.events`. Re-sending events after
  a restore is safe.
- **Testing** (`@mortal-doctrine/audio/testing`): `createFakeAudioContext` (records gains,
  sources, `resume`, `close`, decodes), `FakeGestureTarget` (counts listeners), `FIXTURE_CUES`,
  `FIXTURE_EVENTS` (current event shapes), `createToneBuffers` (synthesized placeholder tones).
- The Studio **Audio Lab** (`/labs/audio`) uses the production player with a real
  `AudioContext` and the fixture tones.
