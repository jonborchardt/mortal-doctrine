import { InputBit, type InputBitName, type InputFrame } from '@mortal-doctrine/sim-core';

/**
 * Physical key codes (`KeyboardEvent.code`) per `InputFrame` bit, so bindings survive keyboard
 * layout changes.
 */
export type KeyBindings = Readonly<Record<InputBitName, readonly string[]>>;

/** Gamepad bindings by button / axis index (defaults assume the W3C "standard" mapping). */
export interface GamepadBindings {
  readonly buttons: Readonly<Record<InputBitName, readonly number[]>>;
  /** Axis indices of the stick read as a digital direction (-x is left, -y is up). */
  readonly stick: { readonly x: number; readonly y: number };
  /** An axis counts as a direction once its magnitude exceeds this (0..1). */
  readonly deadzone: number;
}

/** One player's device assignment and bindings. Plain JSON-serializable data. */
export interface PlayerBindings {
  /** Key codes this player listens to; `null` assigns no keyboard. */
  readonly keyboard: KeyBindings | null;
  /** Index into `navigator.getGamepads()`; `null` assigns no gamepad. */
  readonly gamepadIndex: number | null;
  readonly gamepad: GamepadBindings;
}

/** D-pad, X Y RB (A1-A3) and A B RT (A4-A6) on a standard-mapping pad; left stick. */
export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  buttons: {
    LEFT: [14],
    RIGHT: [15],
    UP: [12],
    DOWN: [13],
    A1: [2],
    A2: [3],
    A3: [5],
    A4: [0],
    A5: [1],
    A6: [7],
  },
  stick: { x: 0, y: 1 },
  deadzone: 0.5,
};

/**
 * Player 1 then player 2. The key sets are disjoint. With a single pad connected (index 0) it
 * drives player 2, so one keyboard plus one pad is a two-player setup out of the box.
 */
export const DEFAULT_PLAYER_BINDINGS: readonly [PlayerBindings, PlayerBindings] = [
  {
    keyboard: {
      LEFT: ['ArrowLeft', 'KeyA'],
      RIGHT: ['ArrowRight', 'KeyD'],
      UP: ['ArrowUp', 'KeyW'],
      DOWN: ['ArrowDown', 'KeyS'],
      A1: ['KeyU'],
      A2: ['KeyI'],
      A3: ['KeyO'],
      A4: ['KeyJ'],
      A5: ['KeyK'],
      A6: ['KeyL'],
    },
    gamepadIndex: 1,
    gamepad: DEFAULT_GAMEPAD_BINDINGS,
  },
  {
    keyboard: {
      LEFT: ['Numpad4'],
      RIGHT: ['Numpad6'],
      UP: ['Numpad8'],
      DOWN: ['Numpad5'],
      A1: ['Digit1'],
      A2: ['Digit2'],
      A3: ['Digit3'],
      A4: ['Digit4'],
      A5: ['Digit5'],
      A6: ['Digit6'],
    },
    gamepadIndex: 0,
    gamepad: DEFAULT_GAMEPAD_BINDINGS,
  },
];

/** The part of a browser `Gamepad` that capture reads. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

/** Where device state comes from. Injectable so capture runs in Node tests. */
export interface InputSources {
  /** Receives `keydown`, `keyup` and `blur`. */
  readonly window: EventTarget;
  /** Receives `visibilitychange`. */
  readonly document: EventTarget & { readonly visibilityState: string };
  getGamepads(): readonly (GamepadLike | null)[];
}

/** The real browser devices. */
export function browserInputSources(): InputSources {
  return { window, document, getGamepads: () => navigator.getGamepads() };
}

/** Read-only view of raw device state for diagnostics (Input Lab). Reading it consumes nothing. */
export interface InputDiagnostics {
  /** Bound key codes currently held. */
  readonly keys: readonly string[];
  /** Bits held right now on keyboard or gamepad, without latched presses. */
  readonly held: InputFrame;
  /** Key presses seen since the previous `sample()`; the next sample includes them. */
  readonly latched: InputFrame;
  /** Pressed button indices and stick position of the assigned pad; `null` if none is connected. */
  readonly gamepad: {
    readonly buttons: readonly number[];
    readonly stick: readonly [number, number];
  } | null;
}

export interface InputCapture {
  /**
   * This tick's raw `InputFrame`: everything held now plus every key pressed since the previous
   * sample, so a tap shorter than a tick still shows up exactly once. Opposing directions are
   * kept; the simulation resolves them. Call exactly once per simulation tick.
   */
  sample(): InputFrame;
  inspect(): InputDiagnostics;
  /** Removes every listener and stops reading gamepads; `sample()` is neutral afterwards. */
  dispose(): void;
}

const BITS = Object.entries(InputBit) as [InputBitName, number][];

export function createInputCapture(
  bindings: PlayerBindings,
  sources: InputSources = browserInputSources(),
): InputCapture {
  const { keyboard, gamepad, gamepadIndex } = bindings;
  const bitOfKey = new Map<string, number>();
  if (keyboard) {
    for (const [name, bit] of BITS) for (const code of keyboard[name]) bitOfKey.set(code, bit);
  }
  const heldKeys = new Set<string>();
  let latched = 0;
  let disposed = false;

  const onKeyDown = (event: Event) => {
    const { code } = event as KeyboardEvent;
    const bit = bitOfKey.get(code);
    if (bit === undefined) return;
    heldKeys.add(code);
    latched |= bit;
  };
  const onKeyUp = (event: Event) => heldKeys.delete((event as KeyboardEvent).code);
  // Key-up events are lost while the page is unfocused or hidden; drop everything to avoid
  // stuck keys.
  const release = () => {
    heldKeys.clear();
    latched = 0;
  };
  const onVisibilityChange = () => {
    if (sources.document.visibilityState === 'hidden') release();
  };

  const listeners: [EventTarget, string, (event: Event) => void][] = keyboard
    ? [
        [sources.window, 'keydown', onKeyDown],
        [sources.window, 'keyup', onKeyUp],
        [sources.window, 'blur', release],
        [sources.document, 'visibilitychange', onVisibilityChange],
      ]
    : [];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);

  const readPad = (): GamepadLike | null => {
    if (disposed || gamepadIndex === null) return null;
    const pad = sources.getGamepads()[gamepadIndex];
    return pad?.connected ? pad : null;
  };
  // ponytail: pads are polled only here, so a pad press shorter than a tick can be missed;
  // add a latching poll timer if that ever matters in play.
  const padFrame = (pad: GamepadLike | null): InputFrame => {
    if (!pad) return 0;
    let frame = 0;
    for (const [name, bit] of BITS) {
      if (gamepad.buttons[name].some((index) => pad.buttons[index]?.pressed)) frame |= bit;
    }
    const x = pad.axes[gamepad.stick.x] ?? 0;
    const y = pad.axes[gamepad.stick.y] ?? 0;
    if (x < -gamepad.deadzone) frame |= InputBit.LEFT;
    if (x > gamepad.deadzone) frame |= InputBit.RIGHT;
    if (y < -gamepad.deadzone) frame |= InputBit.UP;
    if (y > gamepad.deadzone) frame |= InputBit.DOWN;
    return frame;
  };
  const keyFrame = (): InputFrame => {
    let frame = 0;
    for (const code of heldKeys) frame |= bitOfKey.get(code) ?? 0;
    return frame;
  };

  return {
    sample() {
      const frame = keyFrame() | latched | padFrame(readPad());
      latched = 0;
      return frame;
    },
    inspect() {
      const pad = readPad();
      return {
        keys: [...heldKeys],
        held: keyFrame() | padFrame(pad),
        latched,
        gamepad: pad && {
          buttons: pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])),
          stick: [pad.axes[gamepad.stick.x] ?? 0, pad.axes[gamepad.stick.y] ?? 0],
        },
      };
    },
    dispose() {
      disposed = true;
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
      release();
    },
  };
}
