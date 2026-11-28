import type { View } from '@mortal-doctrine/renderer';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import type { Arena } from './schema';

/**
 * Screen position (logical pixels) of the authored point `(x, y)` of a layer with parallax
 * factor `parallax`, for a viewport `viewportWidth` logical pixels wide. Horizontal parallax
 * only: at factor 1 the point moves with the gameplay plane, at 0 it is fixed on screen, and
 * when the camera is centred on the visual bounds every factor gives the same x. The authored
 * `groundLine` maps to `view.originY` for every factor.
 */
export function parallaxToScreen(
  view: View,
  viewportWidth: number,
  { groundLine, visualBounds }: Pick<Arena, 'groundLine' | 'visualBounds'>,
  parallax: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const toPixels = view.scale / SUBUNITS_PER_UNIT;
  const centre = (viewportWidth / 2 - view.originX) / toPixels;
  const reference = (visualBounds.left + visualBounds.right) / 2;
  return {
    x: viewportWidth / 2 + (x - reference - parallax * (centre - reference)) * toPixels,
    y: view.originY - (y - groundLine) * toPixels,
  };
}
