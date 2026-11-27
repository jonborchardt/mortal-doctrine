import { widestPushboxWidth } from '@mortal-doctrine/movement';
import type { View } from '@mortal-doctrine/renderer';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import type { SimulationEvent, SimulationState } from '@mortal-doctrine/simulation';

/** A horizontal world interval in simulation sub-units. */
export interface WorldSpan {
  readonly left: number;
  readonly right: number;
}

export interface ShakeConfig {
  /** Peak offset in logical pixels, on the first frame. */
  readonly amplitude: number;
  /** Frames until the offset is exactly zero; a positive integer. */
  readonly frames: number;
}

export interface CameraConfig {
  /** Logical viewport in pixels; the renderer's `width` and `height`. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** Visual bounds: the camera never shows world x outside them. Supplied by the arena. */
  readonly bounds: WorldSpan;
  /** Zoom limits as visible world width in sub-units (min = closest zoom). */
  readonly minVisibleWidth: number;
  readonly maxVisibleWidth: number;
  /** Sub-units kept free between each outer pushbox edge and the frame edge, zoom permitting. */
  readonly margin: number;
  /** Logical pixels between the ground line and the viewport bottom, at every zoom. */
  readonly groundMargin: number;
  /** Fraction of the remaining distance covered per simulation frame, in (0, 1]; 1 = no smoothing. */
  readonly smoothing: number;
  /** Simulation event types that shake the view. Types not listed do nothing. */
  readonly shake: Readonly<Partial<Record<SimulationEvent['type'], ShakeConfig>>>;
}

export interface CameraOutput {
  /** What to pass to `ArenaRenderer.setView`: `steady` plus shake, clamped to the bounds. */
  readonly view: View;
  /** The smoothed view before shake. */
  readonly steady: View;
  /** The visible span the camera is converging to. */
  readonly target: WorldSpan;
  /** Shake offset in logical pixels before the bounds clamp; `{ 0, 0 }` at rest. */
  readonly shake: { readonly x: number; readonly y: number };
}

export interface Camera {
  /**
   * Advances to `state.frame` and returns the view for it. `events` are the events of the ticks
   * run since the previous update. Reads its arguments only.
   */
  update(state: SimulationState, events?: readonly SimulationEvent[]): CameraOutput;
}

// More frames than the simulation runner ever runs in one `advance` (250 ms): a seek, not play.
const MAX_CATCH_UP_FRAMES = 15;
// Sub-units; closer than this the smoothed value becomes the target, so the camera comes to rest.
const SNAP_DISTANCE = 1;
// Successive shake directions are a golden angle apart: no visible axis or repetition.
const GOLDEN_ANGLE = 2.399963229728653;

/** The span covering both fighters' widest pushboxes, so a crouch or jump never changes it. */
export function fighterSpan(state: SimulationState): WorldSpan {
  const edges = state.fighters.flatMap((fighter) => {
    const half = widestPushboxWidth(fighter.params) / 2;
    return [fighter.x - half, fighter.x + half];
  });
  return { left: Math.min(...edges), right: Math.max(...edges) };
}

/** The world span a view shows across a viewport `viewportWidth` logical pixels wide. */
export function visibleSpan(view: View, viewportWidth: number): WorldSpan {
  const perPixel = SUBUNITS_PER_UNIT / view.scale;
  return { left: -view.originX * perPixel, right: (viewportWidth - view.originX) * perPixel };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function assertConfig(config: CameraConfig): void {
  const { viewport, bounds, minVisibleWidth, maxVisibleWidth, margin, smoothing, shake } = config;
  const problems = [
    viewport.width > 0 && viewport.height > 0 ? '' : 'viewport: width and height must be > 0',
    bounds.right > bounds.left ? '' : 'bounds: right must be greater than left',
    minVisibleWidth > 0 && minVisibleWidth <= maxVisibleWidth
      ? ''
      : 'minVisibleWidth: must be > 0 and at most maxVisibleWidth',
    margin >= 0 ? '' : 'margin: must be >= 0',
    smoothing > 0 && smoothing <= 1 ? '' : 'smoothing: must be in (0, 1]',
    ...Object.entries(shake).map(([type, { amplitude, frames }]) =>
      amplitude >= 0 && Number.isInteger(frames) && frames > 0
        ? ''
        : `shake.${type}: amplitude must be >= 0 and frames a positive integer`,
    ),
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`Invalid camera config: ${problems.join('; ')}`);
}

/** Creates a camera at rest. Throws naming the field for an invalid `config`. */
export function createCamera(config: CameraConfig): Camera {
  assertConfig(config);
  const { viewport, bounds, margin, smoothing } = config;
  // Bounds win over the zoom limits: never wider than the bounds themselves.
  const maxWidth = Math.min(config.maxVisibleWidth, bounds.right - bounds.left);
  const minWidth = Math.min(config.minVisibleWidth, maxWidth);
  const withinBounds = (centre: number, width: number) =>
    clamp(centre, bounds.left + width / 2, bounds.right - width / 2);
  const approach = (current: number, target: number) => {
    const next = current + (target - current) * smoothing;
    return Math.abs(target - next) < SNAP_DISTANCE ? target : next;
  };

  let lastFrame: number | undefined;
  let centre = 0;
  let width = 0;
  let shakes: { readonly start: number; readonly amplitude: number; readonly frames: number }[] =
    [];
  let output: CameraOutput | undefined;

  return {
    update(state, events = []) {
      // The same frame again changes nothing: its events were already consumed.
      if (output && state.frame === lastFrame) return output;

      const span = fighterSpan(state);
      const targetWidth = clamp(span.right - span.left + 2 * margin, minWidth, maxWidth);
      const targetCentre = withinBounds((span.left + span.right) / 2, targetWidth);
      const steps = lastFrame === undefined ? -1 : state.frame - lastFrame;
      if (lastFrame === undefined || steps < 0 || steps > MAX_CATCH_UP_FRAMES) {
        // First snapshot, reset, restore or seek: no history to smooth from, nothing to shake.
        centre = targetCentre;
        width = targetWidth;
        shakes = [];
      } else {
        for (let i = 0; i < steps; i++) {
          centre = approach(centre, targetCentre);
          width = approach(width, targetWidth);
        }
        // Smoothing may lag the margin, never a fighter: both pushboxes stay in frame.
        width = Math.max(width, Math.min(span.right - span.left, maxWidth));
        centre = withinBounds(
          Math.min(span.left + width / 2, Math.max(span.right - width / 2, centre)),
          width,
        );
        for (const event of events) {
          const shake = config.shake[event.type];
          // Only events of the ticks just run; anything older was seen or belongs to a seek.
          if (shake && event.frame >= lastFrame && event.frame < state.frame) {
            shakes.push({ start: event.frame, ...shake });
          }
        }
      }
      lastFrame = state.frame;

      // An event of tick f is first shown by snapshot f + 1, at age 0.
      const tick = state.frame - 1;
      shakes = shakes.filter((shake) => tick - shake.start < shake.frames);
      // The strongest active shake wins, so the offset never exceeds a configured amplitude.
      let shake = { x: 0, y: 0 };
      let strongest = 0;
      for (const { start, amplitude, frames } of shakes) {
        const age = tick - start;
        const strength = amplitude * (1 - age / frames);
        if (strength > strongest) {
          strongest = strength;
          const angle = (start + age) * GOLDEN_ANGLE;
          shake = { x: strength * Math.cos(angle), y: strength * Math.sin(angle) };
        }
      }

      const scale = (viewport.width * SUBUNITS_PER_UNIT) / width;
      const toPixels = scale / SUBUNITS_PER_UNIT;
      const steady: View = {
        scale,
        originX: -(centre - width / 2) * toPixels,
        originY: viewport.height - config.groundMargin,
      };
      output = {
        view: {
          scale,
          // Shake is clamped too: the bounds win over every other rule.
          originX: clamp(
            steady.originX + shake.x,
            viewport.width - bounds.right * toPixels,
            -bounds.left * toPixels,
          ),
          originY: steady.originY + shake.y,
        },
        steady,
        target: { left: targetCentre - targetWidth / 2, right: targetCentre + targetWidth / 2 },
        shake,
      };
      return output;
    },
  };
}
