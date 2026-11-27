import { InputBit, inputFrameSchema, NEUTRAL_INPUT } from '@mortal-doctrine/sim-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInputCapture,
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  type GamepadLike,
  type InputSources,
  type PlayerBindings,
} from '../src/index';

const { LEFT, RIGHT, UP, DOWN, A1, A2, A3, A4, A5, A6 } = InputBit;
const [P1, P2] = DEFAULT_PLAYER_BINDINGS;
const ALL_BITS = 1023;

/** EventTarget that counts listener registrations, to prove disposal removes every one. */
class CountingTarget extends EventTarget {
  added = 0;
  removed = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    this.added++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) {
    this.removed++;
    super.removeEventListener(...args);
  }
}

function fakeSources() {
  const window = new CountingTarget();
  const document = Object.assign(new CountingTarget(), { visibilityState: 'visible' });
  const state = { pads: [] as (GamepadLike | null)[], polls: 0 };
  const sources: InputSources = {
    window,
    document,
    getGamepads: () => {
      state.polls++;
      return state.pads;
    },
  };
  // Node provides EventTarget/Event but not KeyboardEvent; `code` is all the module reads.
  const key = (type: 'keydown' | 'keyup', code: string) =>
    window.dispatchEvent(Object.assign(new Event(type), { code }));
  return {
    sources,
    window,
    document,
    state,
    down: (code: string) => key('keydown', code),
    up: (code: string) => key('keyup', code),
    hide() {
      document.visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

function pad(pressed: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0]): GamepadLike {
  return {
    connected: true,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
    axes,
  };
}

const keyboardOnly = (bindings: PlayerBindings): PlayerBindings => ({
  ...bindings,
  gamepadIndex: null,
});
const padOnly = (gamepadIndex: number): PlayerBindings => ({ ...P1, keyboard: null, gamepadIndex });

describe('tap latching', () => {
  it('a key pressed and released between two samples sets the bit in exactly one sample', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    expect(input.sample()).toBe(NEUTRAL_INPUT);

    io.down('KeyD');
    io.up('KeyD');
    expect(input.sample()).toBe(RIGHT);
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it('repeated taps between two samples still yield exactly one set sample', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    for (let i = 0; i < 3; i++) {
      io.down('KeyU');
      io.up('KeyU');
    }
    expect(input.sample()).toBe(A1);
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it('inspect shows the pending latch without consuming it', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyD');
    expect(input.inspect()).toMatchObject({ keys: ['KeyD'], held: RIGHT, latched: RIGHT });
    io.up('KeyD');
    expect(input.inspect()).toMatchObject({ keys: [], held: 0, latched: RIGHT });
    expect(input.sample()).toBe(RIGHT);
    expect(input.inspect()).toMatchObject({ keys: [], held: 0, latched: 0, gamepad: null });
  });
});

describe('held keys', () => {
  it('stay set across samples and clear on the first sample after keyup', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyD');
    expect(input.sample()).toBe(RIGHT);
    expect(input.sample()).toBe(RIGHT);
    expect(input.sample()).toBe(RIGHT);
    io.up('KeyD');
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it('keeps opposing directions as pressed', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyD');
    expect(input.sample()).toBe(RIGHT);
    io.down('ArrowLeft');
    expect(input.sample()).toBe(LEFT | RIGHT);
    io.up('KeyD');
    expect(input.sample()).toBe(LEFT);
  });

  it('a bit stays set while any of its keys is held', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyD');
    io.down('ArrowRight');
    input.sample();
    io.up('KeyD');
    expect(input.sample()).toBe(RIGHT);
    io.up('ArrowRight');
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it.each(['blur', 'visibility loss'] as const)('%s clears held keys and latches', (cause) => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyA'); // held
    io.down('KeyU'); // tapped: latch pending
    io.up('KeyU');
    if (cause === 'blur') io.window.dispatchEvent(new Event('blur'));
    else io.hide();
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it('becoming visible again does not clear held keys', () => {
    const io = fakeSources();
    const input = createInputCapture(P1, io.sources);
    io.down('KeyA');
    io.document.dispatchEvent(new Event('visibilitychange'));
    expect(input.sample()).toBe(LEFT);
  });
});

describe('default bindings', () => {
  const keys: Record<'p1' | 'p2', [string, number][]> = {
    p1: [
      ['ArrowLeft', LEFT],
      ['KeyA', LEFT],
      ['ArrowRight', RIGHT],
      ['KeyD', RIGHT],
      ['ArrowUp', UP],
      ['KeyW', UP],
      ['ArrowDown', DOWN],
      ['KeyS', DOWN],
      ['KeyU', A1],
      ['KeyI', A2],
      ['KeyO', A3],
      ['KeyJ', A4],
      ['KeyK', A5],
      ['KeyL', A6],
    ],
    p2: [
      ['Numpad4', LEFT],
      ['Numpad6', RIGHT],
      ['Numpad8', UP],
      ['Numpad5', DOWN],
      ['Digit1', A1],
      ['Digit2', A2],
      ['Digit3', A3],
      ['Digit4', A4],
      ['Digit5', A5],
      ['Digit6', A6],
    ],
  };

  it.each([
    ['p1', P1],
    ['p2', P2],
  ] as const)('%s keyboard binds every direction and button', (player, bindings) => {
    const expected = keys[player];
    expect(Object.values(bindings.keyboard ?? {}).flat()).toHaveLength(expected.length);
    const io = fakeSources();
    const input = createInputCapture(bindings, io.sources);
    for (const [code, bit] of expected) {
      io.down(code);
      expect(input.sample(), code).toBe(bit);
      io.up(code);
    }
    for (const [code] of expected) io.down(code);
    expect(input.sample()).toBe(ALL_BITS);
  });

  it('gamepad binds every direction and button', () => {
    const expected: [number, number][] = [
      [14, LEFT],
      [15, RIGHT],
      [12, UP],
      [13, DOWN],
      [2, A1],
      [3, A2],
      [5, A3],
      [0, A4],
      [1, A5],
      [7, A6],
    ];
    expect(Object.values(DEFAULT_GAMEPAD_BINDINGS.buttons).flat()).toHaveLength(expected.length);
    const io = fakeSources();
    const input = createInputCapture(padOnly(0), io.sources);
    for (const [button, bit] of expected) {
      io.state.pads = [pad([button])];
      expect(input.sample(), `button ${button}`).toBe(bit);
    }
    io.state.pads = [pad(expected.map(([button]) => button))];
    expect(input.sample()).toBe(ALL_BITS);
  });

  it('are plain data, use disjoint keys, and every sample is a valid InputFrame', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_PLAYER_BINDINGS))).toEqual(DEFAULT_PLAYER_BINDINGS);
    const codes = [P1, P2].flatMap((bindings) => Object.values(bindings.keyboard ?? {}).flat());
    expect(new Set(codes).size).toBe(codes.length);

    const io = fakeSources();
    const input = createInputCapture({ ...P1, gamepadIndex: 0 }, io.sources);
    const frames = [input.sample()];
    for (const code of codes) io.down(code);
    io.state.pads = [pad([0, 1, 2, 3, 12, 13, 14, 15], [1, -1])];
    frames.push(input.sample(), input.sample());
    for (const frame of frames) expect(inputFrameSchema.parse(frame)).toBe(frame);
  });
});

describe('gamepad', () => {
  it('d-pad and buttons drive the frame while held', () => {
    const io = fakeSources();
    const input = createInputCapture(padOnly(0), io.sources);
    io.state.pads = [pad([14, 2])];
    expect(input.sample()).toBe(LEFT | A1);
    expect(input.sample()).toBe(LEFT | A1);
    expect(input.inspect()).toMatchObject({ held: LEFT | A1, gamepad: { buttons: [2, 14] } });
    io.state.pads = [pad()];
    expect(input.sample()).toBe(NEUTRAL_INPUT);
  });

  it.each([
    ['left', [-0.6, 0], LEFT],
    ['right', [0.6, 0], RIGHT],
    ['up', [0, -0.6], UP],
    ['down', [0, 0.6], DOWN],
    ['up-right', [1, -1], UP | RIGHT],
  ] as const)('left stick past the deadzone: %s', (_name, axes, expected) => {
    const io = fakeSources();
    const input = createInputCapture(padOnly(0), io.sources);
    io.state.pads = [pad([], axes)];
    expect(input.sample()).toBe(expected);
    expect(input.inspect().gamepad?.stick).toEqual(axes);
  });

  it('stick inside the deadzone contributes nothing; the deadzone is a binding', () => {
    const io = fakeSources();
    io.state.pads = [pad([], [0.5, -0.5])];
    expect(createInputCapture(padOnly(0), io.sources).sample()).toBe(NEUTRAL_INPUT);
    const loose = { ...padOnly(0), gamepad: { ...DEFAULT_GAMEPAD_BINDINGS, deadzone: 0.2 } };
    expect(createInputCapture(loose, io.sources).sample()).toBe(UP | RIGHT);
  });

  it('a missing, null or disconnected pad contributes nothing', () => {
    const io = fakeSources();
    const input = createInputCapture(padOnly(0), io.sources);
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    io.state.pads = [null];
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    io.state.pads = [{ ...pad([0, 14], [1, 1]), connected: false }];
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    expect(input.inspect().gamepad).toBeNull();
  });

  it('an unassigned gamepad is never polled', () => {
    const io = fakeSources();
    io.state.pads = [pad([0])];
    const input = createInputCapture(keyboardOnly(P1), io.sources);
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    input.inspect();
    expect(io.state.polls).toBe(0);
  });
});

describe('two players', () => {
  it('keyboard vs keyboard: disjoint key sets do not cross', () => {
    const io = fakeSources();
    const p1 = createInputCapture(keyboardOnly(P1), io.sources);
    const p2 = createInputCapture(keyboardOnly(P2), io.sources);
    io.down('KeyD');
    io.down('Numpad4');
    io.down('Digit1');
    io.up('Digit1');
    expect([p1.sample(), p2.sample()]).toEqual([RIGHT, LEFT | A1]);
    expect([p1.sample(), p2.sample()]).toEqual([RIGHT, LEFT]);
  });

  it('keyboard vs gamepad', () => {
    const io = fakeSources();
    const p1 = createInputCapture(keyboardOnly(P1), io.sources);
    const p2 = createInputCapture(padOnly(0), io.sources);
    io.down('KeyU');
    io.state.pads = [pad([15])];
    expect([p1.sample(), p2.sample()]).toEqual([A1, RIGHT]);
  });

  it('gamepad index 0 vs 1', () => {
    const io = fakeSources();
    const p1 = createInputCapture(padOnly(0), io.sources);
    const p2 = createInputCapture(padOnly(1), io.sources);
    io.state.pads = [pad([14]), pad([0], [0.9, 0])];
    expect([p1.sample(), p2.sample()]).toEqual([LEFT, RIGHT | A4]);
    io.state.pads = [null, pad([1])];
    expect([p1.sample(), p2.sample()]).toEqual([NEUTRAL_INPUT, A5]);
  });
});

describe('dispose', () => {
  it('removes every listener, stops polling and samples neutral afterwards', () => {
    const io = fakeSources();
    const input = createInputCapture({ ...P1, gamepadIndex: 0 }, io.sources);
    expect(io.window.added).toBe(3); // keydown, keyup, blur
    expect(io.document.added).toBe(1); // visibilitychange
    io.down('KeyA');
    io.state.pads = [pad([0])];
    expect(input.sample()).toBe(LEFT | A4);
    const polls = io.state.polls;

    input.dispose();
    expect(io.window.removed).toBe(io.window.added);
    expect(io.document.removed).toBe(io.document.added);

    io.down('KeyD');
    expect(input.sample()).toBe(NEUTRAL_INPUT);
    expect(input.inspect()).toEqual({ keys: [], held: 0, latched: 0, gamepad: null });
    expect(io.state.polls).toBe(polls);
  });

  it('removal is real: a second capture on the same targets keeps working', () => {
    const io = fakeSources();
    const first = createInputCapture(P1, io.sources);
    const second = createInputCapture(P1, io.sources);
    first.dispose();
    io.down('KeyD');
    expect(first.sample()).toBe(NEUTRAL_INPUT);
    expect(second.sample()).toBe(RIGHT);
  });
});

describe('default browser sources', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the keyboard working where the Gamepad API is absent', () => {
    const window = new EventTarget();
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('navigator', {});
    const capture = createInputCapture(P1);
    window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }));
    expect(capture.sample()).toBe(RIGHT);
    expect(capture.inspect().gamepad).toBeNull();
    capture.dispose();
  });
});
