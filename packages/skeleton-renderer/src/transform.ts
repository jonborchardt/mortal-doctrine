import type { Transform, Vec2 } from '@mortal-doctrine/math';
import { worldToScreen, type View } from '@mortal-doctrine/renderer';

/** 1 faces right (as authored); -1 mirrors the rig about the character origin. */
export type Facing = 1 | -1;

/**
 * Maps an attachment image's local space to the screen. Image space is y-down logical pixels
 * (1 px = 1 world unit at `view.scale` 1) with its origin at the slot origin and +x along the
 * bone's +x; `slot` is the evaluated slot transform (rig space, y-up, world units); `origin` is
 * the character origin in world sub-units. The result is a y-down screen affine in the same
 * `a b c d tx ty` layout as a Pixi matrix. Its determinant has the sign of `facing` (for a bone
 * that is not itself mirrored), so textures are only ever flipped by facing -1. Pure.
 */
export function slotDisplayTransform(
  slot: Transform,
  facing: Facing,
  origin: Vec2,
  view: View,
): Transform {
  const at = worldToScreen(view, origin.x, origin.y);
  const x = view.scale * facing;
  const y = -view.scale;
  // Image y-down to bone-local y-up negates the second column; the y-up to y-down screen flip
  // negates the second row; facing negates the first row.
  return {
    a: x * slot.a,
    b: y * slot.b,
    c: -x * slot.c,
    d: -y * slot.d,
    tx: at.x + x * slot.tx,
    ty: at.y + y * slot.ty,
  };
}
