import { InputBit, type InputFrame } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import {
  commandListSchema,
  commandsSliceSchema,
  createCommandsSlice,
  parseCommandList,
  updateCommands,
  type CommandDefinition,
  type Facing,
} from '../src/index';
import {
  advanceRun,
  CHARGE,
  CHORD,
  GENERIC_COMMANDS,
  mirror,
  MOTION_CASES,
  QUARTER_CIRCLE,
  RELEASE,
  SAME_FRAME_CHORD,
  soloInputs,
  spanned,
  startRun,
  commandCycleScript,
} from '../src/testing';

const { LEFT, RIGHT, DOWN, A1, A2, A3, A4, A5, A6 } = InputBit;
const same = (frame: InputFrame) => frame;
const repeat = (frame: InputFrame, count: number): InputFrame[] =>
  Array<InputFrame>(count).fill(frame);

/** Player 0's events for `frames` under `facing`, as `[command, frame]` pairs. */
function recognized(
  definitions: readonly CommandDefinition[],
  frames: readonly InputFrame[],
  facing: Facing = 'right',
  historyCapacity = 60,
): [string, number][] {
  const { events } = advanceRun(startRun(definitions, historyCapacity), soloInputs(frames), [
    facing,
    'left',
  ]);
  return events.map((event) => [event.command, event.frame]);
}

const FACINGS: [Facing, (frame: InputFrame) => InputFrame][] = [
  ['right', same],
  ['left', mirror],
];

describe.each(MOTION_CASES)('motion $definition.id', ({ definition, steps, button }) => {
  const max = definition.maxFrames;
  const id = definition.id;

  it.each(FACINGS)('is recognized spanning exactly maxFrames, facing %s', (facing, map) => {
    expect(recognized([definition], spanned(steps, button, max).map(map), facing)).toEqual([
      [id, max - 1],
    ]);
    // The tightest input (one frame per step) too.
    const tight = spanned(steps, button, steps.length).map(map);
    expect(recognized([definition], tight, facing)).toEqual([[id, steps.length - 1]]);
  });

  it.each(FACINGS)('is rejected spanning maxFrames + 1, facing %s', (facing, map) => {
    expect(recognized([definition], spanned(steps, button, max + 1).map(map), facing)).toEqual([]);
  });

  it('is rejected when the unmirrored input is entered facing the other way', () => {
    expect(recognized([definition], spanned(steps, button, max), 'left')).toEqual([]);
  });

  it('fires only on the trigger press, not while the button stays held', () => {
    const frames = [...spanned(steps, button, max), ...repeat((steps.at(-1) ?? 0) | button, 5)];
    expect(recognized([definition], frames)).toEqual([[id, max - 1]]);
  });
});

describe('charge', () => {
  const { frames: charge } = CHARGE.charge ?? { frames: 0 };
  const max = CHARGE.maxFrames;
  /** Hold back `held` frames, `gap` neutral frames, then forward + A5. */
  const input = (held: number, gap: number, back: InputFrame = LEFT) => [
    ...repeat(back, held),
    ...repeat(0, gap),
    RIGHT | A5,
  ];
  const cases: [string, number, number, boolean][] = [
    ['frames - 1 held frames', charge - 1, 0, false],
    ['exactly frames held frames', charge, 0, true],
    ['a hold that ended maxFrames before the trigger', charge, max - 1, true],
    ['a hold that ended maxFrames + 1 before the trigger', charge, max, false],
    ['a long hold', 200, 0, true],
  ];

  it.each(cases)('%s', (_, held, gap, expected) => {
    const trigger = held + gap;
    for (const [facing, map] of FACINGS) {
      expect(recognized([CHARGE], input(held, gap).map(map), facing)).toEqual(
        expected ? [['charge', trigger]] : [],
      );
    }
  });

  it('counts down-back as back, and a broken hold restarts', () => {
    expect(recognized([CHARGE], input(charge, 0, DOWN | LEFT))).toEqual([['charge', charge]]);
    const broken = [...repeat(LEFT, 10), 0, ...repeat(LEFT, charge - 1), RIGHT | A5];
    expect(recognized([CHARGE], broken)).toEqual([]);
  });

  it('is recognized with a charge longer than the history capacity', () => {
    expect(charge).toBeGreaterThan(12);
    expect(recognized([CHARGE], input(charge, 0), 'right', 12)).toEqual([['charge', charge]]);
    expect(recognized([CHARGE], input(charge - 1, 0), 'right', 12)).toEqual([]);
  });

  it('survives serialize and restore mid-charge', () => {
    const frames = soloInputs([...input(charge, 3), ...input(charge, 0)]);
    const whole = advanceRun(startRun([CHARGE], 12), frames);
    expect(whole.events).toHaveLength(2);
    for (const split of [1, charge - 1, charge, charge + 2]) {
      const first = advanceRun(startRun([CHARGE], 12), frames.slice(0, split));
      const saved = JSON.parse(JSON.stringify(first.run)) as typeof first.run;
      const restored = { ...saved, slice: commandsSliceSchema.parse(saved.slice) };
      expect(restored).toEqual(first.run);
      const rest = advanceRun(restored, frames.slice(split));
      expect([...first.events, ...rest.events]).toEqual(whole.events);
      expect(JSON.stringify(rest.run)).toBe(JSON.stringify(whole.run));
    }
  });
});

describe('chords', () => {
  const window = CHORD.trigger.chordWindow;
  it.each([
    ['A1 then A2', A1, A2],
    ['A2 then A1', A2, A1],
  ])('%s: recognized at chordWindow apart, not at chordWindow + 1', (_, first, second) => {
    const apart = (gap: number) => [...repeat(first, gap), first | second];
    expect(recognized([CHORD], apart(window))).toEqual([['chord', window]]);
    expect(recognized([CHORD], apart(window + 1))).toEqual([]);
    expect(recognized([CHORD], [first | second])).toEqual([['chord', 0]]);
  });

  it('needs every button still held', () => {
    expect(recognized([CHORD], [A1, 0, A2])).toEqual([]);
  });

  it('chordWindow 0 requires the same frame', () => {
    expect(recognized([SAME_FRAME_CHORD], [0, A3 | A4])).toEqual([['same-frame-chord', 1]]);
    expect(recognized([SAME_FRAME_CHORD], [A3, A3 | A4])).toEqual([]);
  });
});

describe('release (negative edge)', () => {
  it('fires on the frame the button goes from held to not held only', () => {
    expect(recognized([RELEASE], [0, A6, A6, A6, 0, 0])).toEqual([['release', 4]]);
    expect(recognized([RELEASE], [0, A6, A6, A6])).toEqual([]);
  });

  it('works with a motion', () => {
    const motionRelease: CommandDefinition = {
      ...QUARTER_CIRCLE,
      id: 'quarter-circle-release',
      trigger: { buttons: ['A6'], edge: 'release', chordWindow: 0 },
    };
    expect(recognized([motionRelease], [A6, DOWN | A6, DOWN | RIGHT | A6, RIGHT])).toEqual([
      ['quarter-circle-release', 3],
    ]);
  });
});

describe('priority', () => {
  const first: CommandDefinition = { ...CHORD, id: 'b-first' };
  const second: CommandDefinition = { ...QUARTER_CIRCLE, id: 'a-second' };
  const qcfChord = [DOWN, DOWN | RIGHT, RIGHT | A1 | A2];

  it('reports simultaneous commands by player, then definition order', () => {
    const run = startRun([first, second]);
    const inputs = qcfChord.map((frame) => [frame, mirror(frame)] as const);
    const { events } = advanceRun(run, inputs);
    expect(events.map((e) => [e.player, e.command, e.frame])).toEqual([
      [0, 'b-first', 2],
      [0, 'a-second', 2],
      [1, 'b-first', 2],
      [1, 'a-second', 2],
    ]);
    expect(recognized([second, first], qcfChord)).toEqual([
      ['a-second', 2],
      ['b-first', 2],
    ]);
  });
});

describe('definition schema', () => {
  const qcf = QUARTER_CIRCLE;
  const cases: [string, unknown, (string | number)[]][] = [
    ['an unknown key', [{ ...qcf, extra: 1 }], [0]],
    ['an unknown trigger key', [{ ...qcf, trigger: { ...qcf.trigger, hold: 1 } }], [0, 'trigger']],
    ['a non-integer maxFrames', [{ ...qcf, maxFrames: 1.5 }], [0, 'maxFrames']],
    ['a zero maxFrames', [{ ...qcf, maxFrames: 0 }], [0, 'maxFrames']],
    [
      'a non-positive charge',
      [{ ...CHARGE, charge: { direction: 'back', frames: 0 } }],
      [0, 'charge', 'frames'],
    ],
    [
      'a negative chord window',
      [{ ...CHORD, trigger: { ...CHORD.trigger, chordWindow: -1 } }],
      [0, 'trigger', 'chordWindow'],
    ],
    [
      'a non-integer chord window',
      [{ ...CHORD, trigger: { ...CHORD.trigger, chordWindow: 0.5 } }],
      [0, 'trigger', 'chordWindow'],
    ],
    [
      'an empty button list',
      [{ ...qcf, trigger: { ...qcf.trigger, buttons: [] } }],
      [0, 'trigger', 'buttons'],
    ],
    [
      'an unknown button',
      [{ ...qcf, trigger: { ...qcf.trigger, buttons: ['A7'] } }],
      [0, 'trigger', 'buttons', 0],
    ],
    [
      'a duplicate button',
      [{ ...CHORD, trigger: { ...CHORD.trigger, buttons: ['A1', 'A1'] } }],
      [0, 'trigger', 'buttons', 1],
    ],
    [
      'a multi-button release',
      [{ ...RELEASE, trigger: { ...RELEASE.trigger, buttons: ['A5', 'A6'] } }],
      [0, 'trigger', 'buttons'],
    ],
    ['an empty motion', [{ ...qcf, motion: [] }], [0, 'motion']],
    ['an unknown direction', [{ ...qcf, motion: ['down', 'sideways'] }], [0, 'motion', 1]],
    ['duplicate ids', [qcf, { ...CHORD, id: qcf.id }], [1, 'id']],
  ];

  it.each(cases)('rejects %s, naming the path', (_, value, path) => {
    const result = commandListSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(path);
    expect(() => parseCommandList(value)).toThrow(`commands.${path.join('.')}:`);
  });

  it('accepts every generic command', () => {
    expect(commandListSchema.parse(GENERIC_COMMANDS)).toEqual(GENERIC_COMMANDS);
  });

  it('rejects definitions that need more history than the capacity', () => {
    expect(() => createCommandsSlice([QUARTER_CIRCLE], 11)).toThrow(
      'commands.0 ("quarter-circle") needs 12 history frames, more than historyCapacity 11',
    );
    expect(() => createCommandsSlice([QUARTER_CIRCLE], 12)).not.toThrow();
    // A chord reads its window plus the frame before the first press.
    expect(() => createCommandsSlice([CHORD], 4)).toThrow(/needs 5 history frames/);
    // A charge's duration does not count, only its maxFrames.
    expect(() => createCommandsSlice([CHARGE], 10)).not.toThrow();
  });
});

describe('commands slice', () => {
  it('holds a counter exactly for charge definitions, for each player', () => {
    const slice = createCommandsSlice([QUARTER_CIRCLE, CHARGE], 60);
    expect(slice.charges).toEqual([
      [null, { run: 0, since: 11 }],
      [null, { run: 0, since: 11 }],
    ]);
    expect(
      commandsSliceSchema.safeParse({ ...slice, charges: [[null], [null, null]] }).success,
    ).toBe(false);
    const misplaced = commandsSliceSchema.safeParse({
      ...slice,
      charges: [[null, null], slice.charges[1]],
    });
    expect(misplaced.error?.issues[0]?.path).toEqual(['charges', 0, 1]);
  });

  it('returns the same slice and no events with no definitions', () => {
    const slice = createCommandsSlice([], 60);
    const result = updateCommands(slice, {
      frame: 0,
      histories: [[A1], [A1]],
      facing: ['right', 'left'],
    });
    expect(result.slice).toBe(slice);
    expect(result.events).toEqual([]);
  });

  it('is deterministic over a long scripted run', () => {
    const inputs = Array.from({ length: 600 }, (_, frame) => commandCycleScript(frame));
    const a = advanceRun(startRun(GENERIC_COMMANDS), inputs);
    const b = advanceRun(startRun(GENERIC_COMMANDS), inputs);
    expect(a.events.length).toBeGreaterThan(20);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
