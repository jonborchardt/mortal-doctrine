import { InputBit } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import { createKeyboardInput, DEFAULT_BINDINGS } from '../src/index';

const { LEFT, RIGHT, UP, DOWN, A1, A2, A3, A4, A5, A6 } = InputBit;

// Node provides EventTarget/Event but not KeyboardEvent; `code` is all the module reads.
function key(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe('keyboard input', () => {
  it('maps held keys to a raw input frame, keeping opposing directions', () => {
    const target = new EventTarget();
    const input = createKeyboardInput(target);
    expect(input.read()).toBe(0);

    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(input.read()).toBe(RIGHT);

    target.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(input.read()).toBe(LEFT | RIGHT);

    target.dispatchEvent(key('keyup', 'KeyD'));
    expect(input.read()).toBe(LEFT);
  });

  it('binds every direction and button by default', () => {
    const expected: [string, number][] = [
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
    ];
    expect(Object.values(DEFAULT_BINDINGS).flat()).toHaveLength(expected.length);
    const target = new EventTarget();
    const input = createKeyboardInput(target);
    for (const [code, bit] of expected) {
      target.dispatchEvent(key('keydown', code));
      expect(input.read(), code).toBe(bit);
      target.dispatchEvent(key('keyup', code));
    }
    for (const [code] of expected) target.dispatchEvent(key('keydown', code));
    expect(input.read()).toBe(1023);
  });

  it('releases all keys on blur and stops listening after dispose', () => {
    const target = new EventTarget();
    const input = createKeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(new Event('blur'));
    expect(input.read()).toBe(0);

    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.read()).toBe(0);
  });
});
