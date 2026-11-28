import { commandCycleScript, GENERIC_COMMANDS } from '@mortal-doctrine/commands/testing';
import { InputBit, TICK_MS, type FrameInputs } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  createSimulationRunner,
  DEFAULT_HISTORY_CAPACITY,
  deserializeState,
  serializeState,
  type InitialStateOptions,
  type InputProvider,
  type SimulationEvent,
} from '@mortal-doctrine/simulation';
import { runFrames, SEEDED_OPTIONS, walkCycleScript } from '@mortal-doctrine/simulation/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createReplayPlayer,
  createReplayRecorder,
  deserializeReplay,
  hashState,
  replaySchema,
  serializeReplay,
  type Replay,
  type ReplayPlayer,
} from '../src/index';

const MATCH_TICKS = 99 * 60;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Records `ticks` single steps of `script`; also returns the live serialized state per frame. */
function record(ticks: number, script: InputProvider = walkCycleScript, checksumInterval = 60) {
  const runner = createSimulationRunner(SEEDED_OPTIONS);
  const recorder = createReplayRecorder({
    options: SEEDED_OPTIONS,
    checksumInterval,
    getState: () => runner.state,
  });
  const provider = recorder.provider(script);
  const live = [serializeState(runner.state)];
  for (let i = 0; i < ticks; i++) {
    runner.stepOnce(provider);
    live.push(serializeState(runner.state));
  }
  return { replay: deepFreeze(recorder.finish()), live };
}

/** A JSON copy of `replay` with one tick's inputs replaced. */
function tamper(replay: Replay, tick: number, change: (inputs: FrameInputs) => FrameInputs) {
  const copy = deserializeReplay(serializeReplay(replay));
  return {
    ...copy,
    inputs: copy.inputs.map((inputs, i) => (i === tick ? change(inputs) : inputs)),
  };
}

/** `replay` as a mutable JSON value, for building malformed files. */
function asJson(replay: Replay) {
  return JSON.parse(serializeReplay(replay)) as {
    replayVersion: unknown;
    options: Record<string, unknown>;
    checksumInterval: unknown;
    inputs: unknown[];
    checksums: { frame: number; stateHash: string; inputsHash: string }[];
  };
}

describe('record and play back', () => {
  let replay: Replay;
  let live: string[];
  beforeAll(() => {
    ({ replay, live } = record(MATCH_TICKS));
  });

  it('reproduces a 99 second session byte for byte at every checksum frame', () => {
    expect(replay.inputs).toHaveLength(MATCH_TICKS);
    expect(replay.checksums.map((checksum) => checksum.frame)).toEqual(
      Array.from({ length: MATCH_TICKS / 60 }, (_, i) => (i + 1) * 60),
    );
    const player = createReplayPlayer(replay);
    expect(player.paused).toBe(true);
    expect(player.frame).toBe(0);
    expect(player.length).toBe(MATCH_TICKS);
    for (const { frame } of replay.checksums) {
      while (player.frame < frame) expect(player.stepOnce()).toBe(true);
      expect(serializeState(player.state)).toBe(live[frame]);
    }
    expect(player.frame).toBe(MATCH_TICKS);
    expect(serializeState(player.state)).toBe(live[MATCH_TICKS]);
    expect(player.desync).toBeNull();
    expect(player.stepOnce()).toBe(false);
    expect(player.frame).toBe(MATCH_TICKS);
  });

  it('plays in whole 60 Hz ticks, only while playing, and stops at the end', () => {
    const player = createReplayPlayer(replay);
    expect(player.advance(1000)).toBe(0);
    player.play();
    expect(player.paused).toBe(false);
    expect(player.advance(TICK_MS * 3)).toBe(3);
    expect(player.advance(TICK_MS / 2)).toBe(0);
    expect(player.advance(TICK_MS / 2)).toBe(1);
    expect(serializeState(player.state)).toBe(live[4]);
    player.pause();
    expect(player.advance(1000)).toBe(0);

    player.seek(MATCH_TICKS - 2);
    player.play();
    expect(player.advance(TICK_MS * 10)).toBe(2);
    expect(player.frame).toBe(MATCH_TICKS);
    expect(player.paused).toBe(true);
    expect(player.desync).toBeNull();
    player.play();
    expect(player.paused).toBe(true);
  });

  it('serializes a 99 second replay to under 200 kB and round-trips it', () => {
    const json = serializeReplay(replay);
    expect(json.length).toBeLessThan(200_000);
    expect(deserializeReplay(json)).toEqual(replay);
  });

  it('seeks to the same state as stepping to the frame, in any order', () => {
    const player = createReplayPlayer(replay);
    for (const frame of [MATCH_TICKS, 0, 1, 120, 77, 3000, 2999, 60, MATCH_TICKS, 1, 0]) {
      player.seek(frame);
      const fresh = createReplayPlayer(replay);
      while (fresh.frame < frame) fresh.stepOnce();
      expect(player.frame).toBe(frame);
      expect(serializeState(player.state)).toBe(serializeState(fresh.state));
      expect(serializeState(player.state)).toBe(live[frame]);
      expect(player.desync).toBeNull();
    }
    for (const frame of [-1, MATCH_TICKS + 1, 1.5, Number.NaN]) {
      expect(() => player.seek(frame)).toThrow(/Seek frame must be an integer in \[0, 5940\]/);
    }
    expect(player.frame).toBe(0);
  });
});

describe('recorder', () => {
  it('records exactly what the inner provider returned, beyond the gameplay history', () => {
    const runner = createSimulationRunner(SEEDED_OPTIONS);
    const recorder = createReplayRecorder({
      options: SEEDED_OPTIONS,
      getState: () => runner.state,
    });
    const returned: FrameInputs[] = [];
    const provider = recorder.provider((frame) => {
      const inputs = walkCycleScript(frame);
      returned.push(inputs);
      return inputs;
    });
    for (let i = 0; i < 40; i++) {
      runner.stepOnce(provider);
      expect(runner.advance(TICK_MS * 5, provider).ticks).toBe(5);
    }
    runner.pause();
    expect(runner.advance(1000, provider).ticks).toBe(0);
    expect(recorder.length).toBe(240);
    runner.stepOnce(provider);

    const replay = recorder.finish();
    expect(replay.inputs).toHaveLength(241);
    expect(replay.inputs.length).toBeGreaterThan(runner.state.input.capacity);
    expect(replay.inputs).toEqual(returned);
    expect(replay.options).toEqual({ ...SEEDED_OPTIONS, commands: [] });
    expect(replaySchema.parse(replay)).toEqual(replay);
  });

  it('takes checksums at exact interval frames however ticks are batched', () => {
    const runner = createSimulationRunner(SEEDED_OPTIONS);
    const recorder = createReplayRecorder({
      options: SEEDED_OPTIONS,
      checksumInterval: 50,
      getState: () => runner.state,
    });
    const provider = recorder.provider(walkCycleScript);
    const batches = new Set<number>();
    for (let i = 0; i < 100; i++)
      batches.add(runner.advance(((i * 7) % 16) * TICK_MS, provider).ticks);
    expect(Math.min(...batches)).toBe(0);
    expect(Math.max(...batches)).toBe(15);
    const replay = recorder.finish();
    const ticks = runner.state.frame;

    expect(ticks % 50).not.toBe(0);
    expect(replay.checksums.map((checksum) => checksum.frame)).toEqual([
      ...Array.from({ length: Math.floor(ticks / 50) }, (_, i) => (i + 1) * 50),
      ticks,
    ]);
    expect(replay).toEqual(record(ticks, walkCycleScript, 50).replay);
  });

  it('stores explicit default options', () => {
    const runner = createSimulationRunner();
    const replay = createReplayRecorder({ getState: () => runner.state }).finish();
    expect(replay.options).toEqual({
      seed: 0,
      historyCapacity: DEFAULT_HISTORY_CAPACITY,
      commands: [],
    });
    expect(replay.checksumInterval).toBe(60);
  });

  it('finishes a zero-tick recording with one checksum at frame 0 that plays back', () => {
    const { replay } = record(0);
    expect(replay.inputs).toEqual([]);
    expect(replay.checksums.map((checksum) => checksum.frame)).toEqual([0]);
    const player = createReplayPlayer(deserializeReplay(serializeReplay(replay)));
    player.play();
    expect(player.advance(1000)).toBe(0);
    expect(player.stepOnce()).toBe(false);
    player.seek(0);
    expect(player.desync).toBeNull();
    expect(serializeState(player.state)).toBe(serializeState(createInitialState(SEEDED_OPTIONS)));
  });

  it('rejects a session that is not at its initial state', () => {
    const state = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 1).state;
    expect(() => createReplayRecorder({ options: SEEDED_OPTIONS, getState: () => state })).toThrow(
      /must start from createInitialState/,
    );
    // Right frame, wrong options.
    const runner = createSimulationRunner();
    expect(() =>
      createReplayRecorder({ options: SEEDED_OPTIONS, getState: () => runner.state }),
    ).toThrow(/must start from createInitialState/);
    expect(() =>
      createReplayRecorder({ checksumInterval: 0, getState: () => runner.state }),
    ).toThrow(/checksumInterval must be an integer >= 1/);
  });

  it('rejects non-contiguous frames, invalid inner results and a mismatched finish', () => {
    const runner = createSimulationRunner(SEEDED_OPTIONS);
    const recorder = createReplayRecorder({
      options: SEEDED_OPTIONS,
      getState: () => runner.state,
    });
    const provider = recorder.provider(walkCycleScript);
    expect(() => provider(1)).toThrow(/non-contiguous.*frame 1 with 0 ticks recorded/);
    runner.stepOnce(provider);
    // Stepping the session without the recorder leaves the recording behind the state.
    runner.stepOnce(walkCycleScript);
    expect(() => provider(1)).toThrow(/non-contiguous.*state at frame 2/);
    expect(() => recorder.finish()).toThrow(/state is at frame 2 but 1 ticks were recorded/);

    const other = createSimulationRunner(SEEDED_OPTIONS);
    const strict = createReplayRecorder({ options: SEEDED_OPTIONS, getState: () => other.state });
    const bad = strict.provider(() => [0, 1 << 10]);
    expect(() => other.stepOnce(bad)).toThrow(/Invalid FrameInputs/);
    expect(strict.length).toBe(0);
    expect(other.state.frame).toBe(0);
    strict.finish();
    expect(() => other.stepOnce(strict.provider(walkCycleScript))).toThrow(/finished/);
    expect(() => strict.finish()).toThrow(/finished/);
  });

  it('leaves no checksum behind when the inner provider fails on a checksum frame', () => {
    const runner = createSimulationRunner(SEEDED_OPTIONS);
    const recorder = createReplayRecorder({
      options: SEEDED_OPTIONS,
      checksumInterval: 3,
      getState: () => runner.state,
    });
    let failure: 'throw' | 'invalid' | null = null;
    const provider = recorder.provider((frame) => {
      if (failure === 'throw') throw new Error('device lost');
      return failure === 'invalid' ? [0, 1 << 10] : walkCycleScript(frame);
    });
    for (let i = 0; i < 3; i++) runner.stepOnce(provider);
    // Frame 3 is a checksum frame; both failures leave the session and the recording at it.
    failure = 'throw';
    expect(() => runner.stepOnce(provider)).toThrow('device lost');
    failure = 'invalid';
    expect(() => runner.stepOnce(provider)).toThrow(/Invalid FrameInputs/);
    expect(recorder.length).toBe(3);
    // A retry records the tick with one checksum for frame 3.
    failure = null;
    runner.stepOnce(provider);
    failure = 'throw';
    for (let i = 0; i < 2; i++) runner.stepOnce(recorder.provider(walkCycleScript));
    // Finishing straight after a failure on checksum frame 6 takes that checksum once.
    expect(() => runner.stepOnce(provider)).toThrow('device lost');
    const replay = recorder.finish();
    expect(replay.checksums.map((checksum) => checksum.frame)).toEqual([3, 6]);
    expect(replaySchema.parse(replay)).toEqual(replay);
    expect(replay).toEqual(record(6, walkCycleScript, 3).replay);
  });

  it('never mutates the states it reads', () => {
    let state = deepFreeze(createInitialState(SEEDED_OPTIONS));
    const recorder = createReplayRecorder({
      options: SEEDED_OPTIONS,
      checksumInterval: 2,
      getState: () => state,
    });
    const provider = recorder.provider(walkCycleScript);
    for (let i = 0; i < 5; i++) {
      state = deepFreeze(runFrames(state, (frame) => provider(frame), 1).state);
    }
    expect(recorder.finish().checksums.map((checksum) => checksum.frame)).toEqual([2, 4, 5]);
  });
});

describe('a session with command definitions', () => {
  // SEEDED_OPTIONS keeps 8 history frames, too few for GENERIC_COMMANDS.
  const COMMAND_OPTIONS = {
    seed: 0x9e37_79b9,
    historyCapacity: 60,
    commands: GENERIC_COMMANDS,
  } satisfies InitialStateOptions;
  // More than one 112-frame cycle of the command scripts; checksums at 60, 120 and 150.
  const TICKS = 150;
  let replay: Replay;
  let live: string[];
  let events: SimulationEvent[];
  beforeAll(() => {
    const runner = createSimulationRunner(COMMAND_OPTIONS);
    const recorder = createReplayRecorder({
      options: COMMAND_OPTIONS,
      getState: () => runner.state,
    });
    const provider = recorder.provider(commandCycleScript);
    live = [serializeState(runner.state)];
    events = [];
    for (let i = 0; i < TICKS; i++) {
      events.push(...runner.stepOnce(provider));
      live.push(serializeState(runner.state));
    }
    replay = deepFreeze(recorder.finish());
  });
  const without = (mutate: (options: Record<string, unknown>) => void) => {
    const json = asJson(replay);
    mutate(json.options);
    return JSON.stringify(json);
  };

  it('records the definitions and plays back identically on every frame', () => {
    expect(replay.options).toEqual(COMMAND_OPTIONS);
    expect(replay.options.commands).toEqual(GENERIC_COMMANDS);
    // Not vacuous: commands were recognized and the definitions are in the state.
    expect(events.some((event) => event.type === 'command')).toBe(true);
    expect(deserializeState(live[TICKS]!).commands.definitions).toEqual(GENERIC_COMMANDS);

    const imported = deserializeReplay(serializeReplay(replay));
    expect(imported).toEqual(replay);
    const player = createReplayPlayer(imported);
    for (let frame = 0; frame <= TICKS; frame++) {
      expect(player.frame).toBe(frame);
      expect(serializeState(player.state)).toBe(live[frame]);
      expect(player.stepOnce()).toBe(frame < TICKS);
    }
    expect(player.desync).toBeNull();
  });

  it('seeks forwards and backwards to the live state and steps on from there', () => {
    const player = createReplayPlayer(deserializeReplay(serializeReplay(replay)));
    for (const frame of [70, TICKS, 45, 0, 119]) {
      player.seek(frame);
      expect(serializeState(player.state)).toBe(live[frame]);
      for (let next = frame + 1; next <= Math.min(frame + 20, TICKS); next++) {
        expect(player.stepOnce()).toBe(true);
        expect(serializeState(player.state)).toBe(live[next]);
      }
      expect(player.desync).toBeNull();
    }
  });

  it.each([
    ['dropped', (options: Record<string, unknown>) => delete options.commands],
    ['emptied', (options: Record<string, unknown>) => (options.commands = [])],
  ])('reports a desync at the first checksum when the definitions are %s', (_name, mutate) => {
    const stripped = deserializeReplay(without(mutate));
    expect(stripped.options.commands).toEqual([]);
    for (const reach of [
      (player: ReplayPlayer) => player.seek(TICKS),
      (player: ReplayPlayer) => {
        player.play();
        for (let i = 0; i < 100; i++) player.advance(TICK_MS * 10);
      },
    ]) {
      const player = createReplayPlayer(stripped);
      reach(player);
      expect(player.frame).toBe(60);
      expect(player.desync?.frame).toBe(60);
      expect(player.desync?.actual.stateHash).not.toBe(player.desync?.expected.stateHash);
    }
  });

  it('refuses to record when the options omit the session definitions', () => {
    const runner = createSimulationRunner(COMMAND_OPTIONS);
    const { seed, historyCapacity } = COMMAND_OPTIONS;
    expect(() =>
      createReplayRecorder({ options: { seed, historyCapacity }, getState: () => runner.state }),
    ).toThrow('Replay recording must start from createInitialState(options)');
    runner.stepOnce(commandCycleScript);
    expect(() =>
      createReplayRecorder({ options: COMMAND_OPTIONS, getState: () => runner.state }),
    ).toThrow('Replay recording must start from createInitialState(options)');
  });

  it('rejects malformed definitions on import, naming the path', () => {
    const importing = (commands: unknown) => () =>
      deserializeReplay(without((options) => (options.commands = commands)));
    const [first, second] = GENERIC_COMMANDS;
    expect(importing('none')).toThrow(/Invalid replay: replay\.options\.commands: /);
    expect(importing([{ ...first, id: undefined }])).toThrow(/replay\.options\.commands\.0\.id: /);
    expect(importing([first, { ...second, id: first?.id }])).toThrow(
      /replay\.options\.commands\.1\.id: duplicate id "quarter-circle"/,
    );
    // GENERIC_COMMANDS[3] is the spin: a 30-frame window, more than 20 frames of history.
    expect(() => deserializeReplay(without((options) => (options.historyCapacity = 20)))).toThrow(
      /replay\.options\.commands\.3: needs 30 history frames, more than historyCapacity 20/,
    );
  });
});

describe('tamper detection', () => {
  let replay: Replay;
  let live: string[];
  beforeAll(() => {
    ({ replay, live } = record(300));
  });
  const { A2, RIGHT } = InputBit;

  it.each([
    [100, 120],
    [119, 120],
    [120, 180],
    [299, 300],
  ])('a changed movement input at tick %i desyncs at checksum frame %i', (tick, frame) => {
    const tampered = tamper(replay, tick, ([p1, p2]) => [p1 ^ RIGHT, p2]);

    const player = createReplayPlayer(tampered);
    player.play();
    for (let i = 0; i < 100; i++) player.advance(TICK_MS * 10);
    expect(player.desync?.frame).toBe(frame);
    expect(player.desync?.actual.stateHash).not.toBe(player.desync?.expected.stateHash);
    const recorded = replay.checksums.find((checksum) => checksum.frame === frame);
    expect(recorded).toBeDefined();
    expect(player.desync?.expected).toEqual({
      stateHash: recorded?.stateHash,
      inputsHash: recorded?.inputsHash,
    });
    expect(player.frame).toBe(frame);
    expect(player.paused).toBe(true);
    // Nothing moves past the desync frame.
    player.play();
    expect(player.paused).toBe(true);
    expect(player.advance(1000)).toBe(0);
    expect(player.stepOnce()).toBe(false);
    player.seek(300);
    expect(player.frame).toBe(frame);

    const seeker = createReplayPlayer(tampered);
    seeker.seek(300);
    expect(seeker.frame).toBe(frame);
    expect(seeker.desync).toEqual(player.desync);
    // Frames before the changed tick still play, and seeking back clears the report.
    seeker.seek(tick);
    expect(seeker.desync).toBeNull();
    expect(serializeState(seeker.state)).toBe(live[tick]);
  });

  it('a changed input with no lasting state effect is detected by the inputs hash alone', () => {
    // SEEDED_OPTIONS keeps 8 history frames, so tick 100 has left the state by frame 120.
    const tampered = tamper(replay, 100, ([p1, p2]) => [p1 ^ A2, p2]);
    for (const reach of [
      (player: ReplayPlayer) => player.seek(300),
      (player: ReplayPlayer) => {
        while (player.stepOnce());
      },
    ]) {
      const player = createReplayPlayer(tampered);
      reach(player);
      expect(player.frame).toBe(120);
      expect(player.desync?.frame).toBe(120);
      expect(player.desync?.actual.stateHash).toBe(player.desync?.expected.stateHash);
      expect(player.desync?.actual.inputsHash).not.toBe(player.desync?.expected.inputsHash);
      expect(serializeState(player.state)).toBe(live[120]);
    }
  });
});

describe('deserializeReplay', () => {
  let replay: Replay;
  beforeAll(() => {
    ({ replay } = record(130));
  });
  /** Expectation on importing the fixture replay after `mutate` changed its JSON value. */
  const reject = (mutate: (json: ReturnType<typeof asJson>) => void) => {
    const json = asJson(replay);
    mutate(json);
    return expect(() => deserializeReplay(JSON.stringify(json)));
  };

  it('reads a replay exported without options.commands as having none', () => {
    const json = asJson(replay);
    delete json.options.commands;
    expect(json.options).toEqual(SEEDED_OPTIONS);
    const imported = deserializeReplay(JSON.stringify(json));
    expect(imported.options).toEqual({ ...SEEDED_OPTIONS, commands: [] });
    expect(imported).toEqual(replay);
    const player = createReplayPlayer(imported);
    player.seek(player.length);
    expect(player.frame).toBe(130);
    expect(player.desync).toBeNull();
  });

  it('rejects text that is not JSON', () => {
    expect(() => deserializeReplay('{"replayVersion":1,')).toThrow(/^Replay is not valid JSON: /);
    expect(() => deserializeReplay('')).toThrow(/^Replay is not valid JSON: /);
  });

  it('rejects missing and unknown versions, naming found and supported', () => {
    reject((json) => {
      json.replayVersion = 2;
    }).toThrow('Unsupported replayVersion 2; supported: 1');
    reject((json) => {
      json.replayVersion = '1';
    }).toThrow('Unsupported replayVersion "1"; supported: 1');
    reject((json) => {
      delete json.replayVersion;
    }).toThrow('Unsupported replayVersion undefined; supported: 1');
    expect(() => deserializeReplay('[1,2]')).toThrow(
      'Unsupported replayVersion undefined; supported: 1',
    );
    expect(() => deserializeReplay('"replay"')).toThrow(
      'Unsupported replayVersion undefined; supported: 1',
    );
  });

  it('rejects schema failures, naming the failing path', () => {
    reject((json) => {
      json.inputs[7] = [0, 1024];
    }).toThrow(/Invalid replay: replay\.inputs\.7\.1: /);
    reject((json) => {
      json.inputs[3] = [0];
    }).toThrow(/replay\.inputs\.3: /);
    reject((json) => {
      json.inputs[3] = [0, 1.5];
    }).toThrow(/replay\.inputs\.3\.1: /);
    reject((json) => {
      delete json.checksumInterval;
    }).toThrow(/replay\.checksumInterval: /);
    reject((json) => {
      json.checksumInterval = 0;
    }).toThrow(/replay\.checksumInterval: /);
    reject((json) => {
      delete (json as Partial<typeof json>).inputs;
    }).toThrow(/replay\.inputs: /);
    reject((json) => {
      json.options.seed = -1;
    }).toThrow(/replay\.options\.seed: /);
    reject((json) => {
      json.options.seed = 2 ** 32;
    }).toThrow(/replay\.options\.seed: /);
    reject((json) => {
      delete json.options.seed;
    }).toThrow(/replay\.options\.seed: /);
    reject((json) => {
      json.options.historyCapacity = 0;
    }).toThrow(/replay\.options\.historyCapacity: /);
    reject((json) => {
      json.options.historyCapacity = 601;
    }).toThrow(/replay\.options\.historyCapacity: /);
    reject((json) => {
      json.checksums[0]!.stateHash = 'XYZ';
    }).toThrow(/replay\.checksums\.0\.stateHash: expected 8 lowercase hex digits/);
  });

  it('rejects checksum frames that are empty, unordered, out of range or not final', () => {
    // The fixture has checksums at frames 60, 120 and 130.
    reject((json) => {
      json.checksums = [];
    }).toThrow(/replay\.checksums: needs at least one checksum/);
    reject((json) => {
      json.checksums[1]!.frame = 60;
    }).toThrow(/replay\.checksums\.1\.frame: frame 60 does not ascend from 60/);
    reject((json) => {
      json.checksums.reverse();
    }).toThrow(/does not ascend from/);
    reject((json) => {
      json.checksums[2]!.frame = 131;
    }).toThrow(/replay\.checksums\.2\.frame: frame 131 is outside 0\.\.130/);
    reject((json) => {
      json.checksums[0]!.frame = -1;
    }).toThrow(/replay\.checksums\.0\.frame: /);
    reject((json) => {
      json.checksums.pop();
    }).toThrow(
      /replay\.checksums\.1\.frame: last checksum frame 120 must equal the input count 130/,
    );
    reject((json) => {
      json.inputs.push([0, 0]);
    }).toThrow(/must equal the input count 131/);
  });
});

describe('hashState', () => {
  const initial = createInitialState(SEEDED_OPTIONS);
  const later = runFrames(initial, walkCycleScript, 200).state;

  it('is equal for equal states and differs between frames', () => {
    expect(hashState(later)).toBe(hashState(runFrames(initial, walkCycleScript, 200).state));
    expect(hashState(later)).toBe(hashState(deserializeState(serializeState(later))));
    expect(hashState(later)).not.toBe(hashState(initial));
    expect(hashState(later)).not.toBe(hashState(runFrames(later, walkCycleScript, 1).state));
    expect(hashState(later)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does not mutate its argument', () => {
    const before = serializeState(later);
    hashState(deepFreeze(later));
    expect(serializeState(later)).toBe(before);
  });

  it('matches the pinned value, so a change to state serialization is noticed', () => {
    // Re-pinned for M1.05: state gained `arena` and the full fighter movement state.
    expect(hashState(initial)).toBe('ed5125eb');
    expect(hashState(later)).toBe('3861d9dc');
  });
});
