import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import type { SimulationState } from '@mortal-doctrine/simulation';

/**
 * World → screen mapping. World space is y-up in simulation sub-units; screen space is y-down in
 * logical pixels. A camera drives it later through `ArenaRenderer.setView`.
 */
export interface View {
  /** Logical pixels per world unit (`SUBUNITS_PER_UNIT` sub-units). */
  readonly scale: number;
  /** Screen position of the world origin (x = 0 at ground level), in logical pixels. */
  readonly originX: number;
  readonly originY: number;
}

// Reference framing: 960 world units across, ground line 80 world units above the bottom edge.
const REFERENCE_WIDTH_UNITS = 960;
const GROUND_MARGIN_UNITS = 80;

/** Static framing for a viewport: at 960×540, 1 world unit = 1 px and the ground line is y 460. */
export function defaultView(width: number, height: number): View {
  const scale = width / REFERENCE_WIDTH_UNITS;
  return { scale, originX: 0, originY: height - GROUND_MARGIN_UNITS * scale };
}

/** Maps a world point in sub-units to logical screen pixels. */
export function worldToScreen(view: View, x: number, y: number): { x: number; y: number } {
  return {
    x: view.originX + (x / SUBUNITS_PER_UNIT) * view.scale,
    y: view.originY - (y / SUBUNITS_PER_UNIT) * view.scale,
  };
}

/**
 * Fighter x (sub-units) blended between the previous and current snapshot by `alpha`. Snaps to
 * the current x unless `previous` is exactly one frame behind (absent, reset or seek).
 */
export function blendFighterX(
  previous: SimulationState | undefined,
  current: SimulationState,
  player: 0 | 1,
  alpha: number,
): number {
  const to = current.fighters[player].x;
  if (!previous || previous.frame !== current.frame - 1) return to;
  const from = previous.fighters[player].x;
  return from + (to - from) * alpha;
}
