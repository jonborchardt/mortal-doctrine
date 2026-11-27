import { InputBit, type InputBitName, type InputFrame } from '@mortal-doctrine/sim-core';

/**
 * Physical key codes (`KeyboardEvent.code`) per `InputFrame` bit, so bindings survive keyboard
 * layout changes.
 */
export type KeyBindings = Readonly<Record<InputBitName, readonly string[]>>;

export const DEFAULT_BINDINGS: KeyBindings = {
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
};

export interface KeyboardInput {
  /**
   * Samples currently held keys as a raw `InputFrame` (opposing directions are kept; the
   * simulation resolves them). Call once per simulation tick.
   */
  read(): InputFrame;
  dispose(): void;
}

export function createKeyboardInput(
  target: EventTarget,
  bindings: KeyBindings = DEFAULT_BINDINGS,
): KeyboardInput {
  const held = new Set<string>();
  const onKeyDown = (event: Event) => held.add((event as KeyboardEvent).code);
  const onKeyUp = (event: Event) => held.delete((event as KeyboardEvent).code);
  // Key-up events are lost while the window is unfocused; drop everything to avoid stuck keys.
  const onBlur = () => held.clear();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  const entries = Object.entries(InputBit) as [InputBitName, number][];

  return {
    read: () =>
      entries.reduce(
        (frame, [name, bit]) =>
          bindings[name].some((code) => held.has(code)) ? frame | bit : frame,
        0,
      ),
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      held.clear();
    },
  };
}
