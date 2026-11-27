import { describe, expect, it } from 'vitest';
import {
  frameInputsSchema,
  InputBit,
  inputFrameSchema,
  NEUTRAL_INPUT,
  parseFrameInputs,
  resolveDirection,
} from '../src/index';

const { LEFT, RIGHT, UP, DOWN } = InputBit;

describe('InputFrame', () => {
  it('assigns directions to bits 0-3 and A1-A6 to bits 4-9; neutral is 0', () => {
    expect(InputBit).toEqual({
      LEFT: 1,
      RIGHT: 2,
      UP: 4,
      DOWN: 8,
      A1: 16,
      A2: 32,
      A3: 64,
      A4: 128,
      A5: 256,
      A6: 512,
    });
    expect(NEUTRAL_INPUT).toBe(0);
  });

  it('accepts every combination of assigned bits and rejects anything else', () => {
    expect(inputFrameSchema.safeParse(0).success).toBe(true);
    expect(inputFrameSchema.safeParse(1023).success).toBe(true);
    for (const bad of [-1, 1.5, 1024, 1 << 10, 2 ** 31, Number.NaN, '1', undefined, null]) {
      expect(inputFrameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('parses exactly two frames and names the problem otherwise', () => {
    expect(parseFrameInputs([LEFT, RIGHT | UP])).toEqual([LEFT, RIGHT | UP]);
    expect(() => parseFrameInputs([0])).toThrow(/Invalid FrameInputs/);
    expect(() => parseFrameInputs([0, 0, 0])).toThrow(/Invalid FrameInputs/);
    expect(() => parseFrameInputs(undefined)).toThrow(/Invalid FrameInputs/);
    expect(() => parseFrameInputs([0, undefined])).toThrow(/\[1\]/);
    expect(() => parseFrameInputs([1024, 0])).toThrow(/\[0\]: input frame sets a bit above bit 9/);
    expect(frameInputsSchema.safeParse([0, -1]).success).toBe(false);
  });
});

describe('resolveDirection', () => {
  it('applies the opposing-direction policy to all 16 direction combinations', () => {
    for (let combo = 0; combo < 16; combo++) {
      const raw = combo | InputBit.A3; // buttons never affect direction
      const left = (combo & LEFT) !== 0;
      const right = (combo & RIGHT) !== 0;
      const up = (combo & UP) !== 0;
      const down = (combo & DOWN) !== 0;
      const expected = {
        x: left && !right ? -1 : right && !left ? 1 : 0,
        y: up ? 1 : down ? -1 : 0,
      };
      expect(resolveDirection(raw), `combo ${combo}`).toEqual(expected);
      // Resolution is derived: the raw frame keeps both opposing bits.
      expect(raw & 15).toBe(combo);
    }
    expect(resolveDirection(LEFT | RIGHT)).toEqual({ x: 0, y: 0 });
    expect(resolveDirection(UP | DOWN)).toEqual({ x: 0, y: 1 });
  });
});
