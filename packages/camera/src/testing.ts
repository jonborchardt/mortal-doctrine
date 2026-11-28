// Public test fixtures (`@mortal-doctrine/camera/testing`). Placeholder framing only, never an
// arena's. For tests and labs; production code must not import this entry point.
import type { CameraConfig } from './camera';

/**
 * 960×540 viewport over the default 96000-wide gameplay arena, with visual bounds 4000
 * sub-units beyond each wall. Visible width 48000 (2 px per world unit) to 104000, which is the
 * whole bounds. Headroom 200 world units: at the closest zoom 230 are visible above the ground, so
 * grounded framing never depends on it. `land` and `wall-contact` shake; `jump` and `command` do not.
 */
export const FIXTURE_CAMERA_CONFIG: CameraConfig = {
  viewport: { width: 960, height: 540 },
  bounds: { left: -4000, right: 100_000 },
  minVisibleWidth: 48_000,
  maxVisibleWidth: 104_000,
  margin: 8000,
  headroom: 20_000,
  groundMargin: 80,
  smoothing: 0.15,
  shake: {
    land: { amplitude: 12, frames: 12 },
    'wall-contact': { amplitude: 6, frames: 8 },
  },
};
