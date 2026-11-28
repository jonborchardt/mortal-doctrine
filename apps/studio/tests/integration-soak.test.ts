import {
  createReplayPlayer,
  deserializeReplay,
  hashState,
  serializeReplay,
} from '@mortal-doctrine/replay';
import { createRngState, nextBelow } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  deserializeState,
  serializeState,
  step,
  type SimulationEvent,
} from '@mortal-doctrine/simulation';
import { expect, it } from 'vitest';
import {
  createSession,
  scriptedInputs,
  SEED,
  SESSION_OPTIONS,
} from '../src/labs/integration/session';

// Ten simulated minutes at 60 Hz, and a little more so the run does not end on a checksum frame.
const FRAMES = 36_000 + 37;
const RESTORES = 24;

/** `count` distinct frames in [1, FRAMES), drawn from the seeded simulation RNG. */
function restoreFrames(count: number): Set<number> {
  const frames = new Set<number>();
  let rng = createRngState(SEED);
  while (frames.size < count) {
    const draw = nextBelow(rng, FRAMES - 1);
    rng = draw.rng;
    frames.add(draw.value + 1);
  }
  return frames;
}

// The run is simulated three times (live, restored, replayed) with a state hash per tick, which
// takes longer than Vitest's 5 s default on a loaded CI runner.
it(
  'ten simulated minutes of scripted input are deterministic under restore and replay',
  { timeout: 120_000 },
  () => {
    const script = scriptedInputs(SEED);

    // The uninterrupted run, recorded through the session the lab uses.
    const session = createSession(script);
    session.record();
    const hashes: string[] = [];
    const events: (readonly SimulationEvent[])[] = [];
    for (let frame = 0; frame < FRAMES; frame++) {
      const [tick] = session.step();
      if (!tick) throw new Error(`no tick ran at frame ${frame}`);
      hashes.push(hashState(tick.state));
      events.push(tick.events);
    }
    session.stop();
    const finalHash = hashes.at(-1);
    expect(session.recorded).toEqual({ frame: FRAMES, hash: finalHash });

    // The script exercises every subsystem that emits events.
    const types = new Set(events.flat().map((event) => event.type));
    expect([...types].sort()).toEqual(['command', 'jump', 'land', 'wall-contact']);

    // The same run again, serialized and restored at seeded random frames.
    const restores = restoreFrames(RESTORES);
    let state = createInitialState(SESSION_OPTIONS);
    for (let frame = 0; frame < FRAMES; frame++) {
      if (restores.has(frame)) state = deserializeState(serializeState(state));
      const result = step(state, script(frame));
      state = result.state;
      if (hashState(state) !== hashes[frame]) {
        expect.fail(`state diverged from the uninterrupted run after tick ${frame}`);
      }
      // The deep comparison runs only to report a difference: 36,000 of them are slow.
      if (JSON.stringify(result.events) !== JSON.stringify(events[frame])) {
        expect(result.events, `events of tick ${frame}`).toEqual(events[frame]);
      }
    }

    // The recording, through its export format, replays without a desync to the same state.
    const recording = session.replay;
    if (!recording) throw new Error('the session kept no recording');
    const replay = deserializeReplay(serializeReplay(recording));
    expect(replay.inputs).toHaveLength(FRAMES);
    const player = createReplayPlayer(replay);
    player.seek(player.length);
    expect(player.desync).toBeNull();
    expect(player.frame).toBe(FRAMES);
    expect(hashState(player.state)).toBe(finalHash);

    console.log(
      `integration soak: ${FRAMES} frames, ${events.flat().length} events, ` +
        `${RESTORES} restores at frames ${[...restores].sort((a, b) => a - b).join(' ')}, ` +
        `${replay.checksums.length} replay checksums, final hash ${finalHash}`,
    );
  },
);
