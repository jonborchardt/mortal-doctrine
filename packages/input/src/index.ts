import type { PlayerInput } from '@mortal-doctrine/simulation';

/** Physical key codes (`KeyboardEvent.code`), so bindings survive keyboard layout changes. */
export interface KeyBindings {
  readonly left: readonly string[];
  readonly right: readonly string[];
}

export const DEFAULT_BINDINGS: KeyBindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
};

export interface KeyboardInput {
  /** Samples currently held keys as simulation input. Call once per simulation advance. */
  read(): PlayerInput;
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

  const isHeld = (codes: readonly string[]) => codes.some((code) => held.has(code));

  return {
    read: () => ({ left: isHeld(bindings.left), right: isHeld(bindings.right) }),
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      held.clear();
    },
  };
}
