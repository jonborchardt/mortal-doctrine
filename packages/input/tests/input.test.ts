import { describe, expect, it } from 'vitest';
import { createKeyboardInput } from '../src/index';

// Node provides EventTarget/Event but not KeyboardEvent; `code` is all the module reads.
function key(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe('keyboard input', () => {
  it('maps held keys to player input', () => {
    const target = new EventTarget();
    const input = createKeyboardInput(target);
    expect(input.read()).toEqual({ left: false, right: false });

    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(input.read()).toEqual({ left: false, right: true });

    target.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(input.read()).toEqual({ left: true, right: true });

    target.dispatchEvent(key('keyup', 'KeyD'));
    expect(input.read()).toEqual({ left: true, right: false });
  });

  it('releases all keys on blur and stops listening after dispose', () => {
    const target = new EventTarget();
    const input = createKeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(new Event('blur'));
    expect(input.read().left).toBe(false);

    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.read().left).toBe(false);
  });
});
