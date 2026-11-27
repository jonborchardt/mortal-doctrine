# @mortal-doctrine/replay

**Layer:** `simulation` · **May depend on:** `sim-core`, `simulation`, `zod`.

Records a simulation session as its seeded initial-state options plus the complete per-tick
`FrameInputs` stream, and plays it back by re-simulating. Periodic checksums of the live session
let playback detect a desync. Pure and headless: no clocks, DOM or Node APIs.

**Non-goals:** netcode and rollback (M7), compression, video export, file dialogs and
persistence, recording simulation events, migrating old replay versions, reverse stepping.
Replays are only valid for the simulation build that recorded them: a behaviour change shows up
as a desync at the first checksum.

## Format

`serializeReplay` writes this object as JSON (a 99 second match is under 200 kB):

```ts
{
  replayVersion: 1,
  options: { seed, historyCapacity },   // createInitialState options, always explicit
  checksumInterval: 60,                 // ticks between checksums
  inputs: [[p1, p2], ...],              // inputs[f] is what tick f was stepped with
  checksums: [{ frame, stateHash, inputsHash }, ...],
}
```

A checksum at `frame` describes the session after `inputs[0..frame)`: `stateHash` is
`hashState` of the live state at that frame and `inputsHash` a running digest of those inputs.
Checksum frames ascend strictly, lie in `0..inputs.length`, and the last one is always
`inputs.length`. Hashes are 8 lowercase hex digits (FNV-1a, 32 bit): they detect desyncs and
accidental edits, not deliberate forgery.

## API

| Export                                                                   | Purpose                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replaySchema`, `Replay`                                                 | Zod schema and types of the format                                                                                                                         |
| `REPLAY_VERSION`                                                         | `1`                                                                                                                                                        |
| `serializeReplay(replay)` / `deserializeReplay(json)`                    | JSON export and import. Import throws on text that is not JSON, an unknown `replayVersion` (naming found and supported) and schema failures (naming paths) |
| `hashState(state)`                                                       | Deterministic hash of `serializeState(state)`                                                                                                              |
| `createReplayRecorder({ options?, checksumInterval?, getState })`        | Recorder: `length`, `provider(inner)`, `finish()`. `checksumInterval` defaults to `60`                                                                     |
| `createReplayPlayer(replay)`                                             | Player: `state`, `frame`, `length`, `paused`, `desync`, `play()`, `pause()`, `advance(elapsedMs)`, `stepOnce()`, `seek(frame)`                             |
| `ReplayRecorder`, `ReplayRecorderConfig`, `ReplayPlayer`, `ReplayDesync` | Their types                                                                                                                                                |

## Recording

The recorder hooks into the simulation runner through its `InputProvider` seam; the runner is
not changed. It never reads the bounded gameplay input history.

```ts
const runner = createSimulationRunner(options);
const recorder = createReplayRecorder({ options, getState: () => runner.state });
const provider = recorder.provider(sampleInputs); // wrap once, use for every tick

runner.advance(elapsedMs, provider); // or runner.stepOnce(provider)
const replay = recorder.finish();
```

Call protocol:

- `createReplayRecorder` throws unless `getState()` is currently `createInitialState(options)`.
  Missing options are stored as explicit defaults.
- The wrapped provider must be called once per tick, in order, with the frame the state is at
  (which is what the runner does). For frame `f` it throws "non-contiguous" unless
  `f === recorder.length === getState().frame`; takes the checksum for `f` when `f > 0` and
  `f % checksumInterval === 0`; then calls `inner(f)` once, validates the result, records it and
  returns it unchanged.
- Every tick of the session must go through the wrapped provider. `finish()` throws if the state
  frame differs from the recorded length (for example after a tick that bypassed the recorder,
  or after `step` threw), takes the final checksum and returns the replay. The recorder cannot be
  used afterwards.

## Playback and the desync rule

```ts
const player = createReplayPlayer(deserializeReplay(json)); // paused at frame 0
player.play();
player.advance(elapsedMs); // from the host's frame loop; whole 60 Hz ticks, stops at the end
player.seek(120); // re-simulates from frame 0 when seeking backwards
render(player.state);
```

Whenever the player reaches a checksum frame it recomputes both hashes. If either differs from
the recorded one, `desync` becomes `{ frame, expected, actual }`, the player pauses on that
frame, and `play`, `advance`, `stepOnce` and `seek` never move past it. Seeking to an earlier
frame clears the report and re-verifies on the way. Because the input digest is checked as well
as the state, a changed input frame is detected at the next checksum even when it had no lasting
effect on state. `seek` throws on a frame that is not an integer in `0..length`. The player never
mutates the replay.

Consumers: the Studio Replay Lab (`/labs/replay`).
