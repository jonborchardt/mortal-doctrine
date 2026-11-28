import { visibleSpan } from '@mortal-doctrine/camera';
import { worldToScreen } from '@mortal-doctrine/renderer';
import { evaluate } from '@mortal-doctrine/rig';
import { InputBit, SUBUNITS_PER_UNIT, type FrameInputs } from '@mortal-doctrine/sim-core';
import { step } from '@mortal-doctrine/simulation';
import { describe, expect, it } from 'vitest';
import { createPresenter } from '../src/index';
import { CAMERA_CONFIG, fighterPose, PRESENTATION, STAGE } from '../src/testing';

const { LEFT, RIGHT, UP } = InputBit;
// Floating-point slack, in pixels.
const SLACK = 1e-6;
const { bounds, maxVisibleWidth, viewport } = CAMERA_CONFIG;

describe('placeholder camera headroom', () => {
  it('does not override the closest zoom of the camera fixture', () => {
    expect(CAMERA_CONFIG.minVisibleWidth).toBe(48_000);
  });

  it.each<{ name: string; inputs: FrameInputs }>([
    { name: 'neutral jumps', inputs: [UP, UP] },
    // Toward each other: the closest framing a jump is seen at.
    { name: 'forward jumps', inputs: [UP | RIGHT, UP | LEFT] },
    { name: 'one neutral jump', inputs: [UP, 0] },
  ])('keeps the airborne mannequins below the viewport top: $name', ({ inputs }) => {
    const presenter = createPresenter({
      ...PRESENTATION,
      audio: { play: () => {} },
      draw: () => {},
    });
    let state = PRESENTATION.initial;
    let highest = 0;
    let widest = 0;
    // Walk together first, so the jump starts from the closest zoom.
    for (let frame = 0; frame < 200; frame++) {
      const jumping = frame >= 120;
      const tick = step(state, jumping ? (frame === 120 ? inputs : [0, 0]) : [RIGHT, LEFT]);
      state = tick.state;
      const { steady } = presenter.present(state, [tick]);
      const visible = visibleSpan(steady, viewport.width);
      widest = Math.max(widest, visible.right - visible.left);
      for (const fighter of state.fighters) {
        highest = Math.max(highest, fighter.y);
        const { anchors } = evaluate(STAGE.rig, fighterPose(fighter, state.frame));
        for (const id of ['crown', 'grip-right']) {
          const anchor = anchors.find((a) => a.id === id);
          if (!anchor) throw new Error(`No anchor ${id}`);
          const top = worldToScreen(steady, 0, fighter.y + anchor.position.y * SUBUNITS_PER_UNIT).y;
          expect(top, `${id} on frame ${state.frame}`).toBeGreaterThanOrEqual(-SLACK);
        }
      }
    }
    // The run did jump, the view did widen for it, and the fit was not cut short by the limits.
    expect(highest).toBeGreaterThan(15_000);
    expect(widest).toBeGreaterThan(CAMERA_CONFIG.minVisibleWidth);
    expect(widest).toBeLessThan(Math.min(maxVisibleWidth, bounds.right - bounds.left));
  });
});
