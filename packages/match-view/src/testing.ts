// Public test fixtures (`@mortal-doctrine/match-view/testing`): the placeholder match, built
// from the other packages' fixtures. For tests and labs. `apps/game` imports it too until
// content packages exist (see `docs/testing.md`); no other production code may.
import { loadClip, sample, type AnimatedPose } from '@mortal-doctrine/animation';
import { RAISE_STAFF, WALK_CYCLE } from '@mortal-doctrine/animation/testing';
import { parseArena } from '@mortal-doctrine/arena';
import { PLACEHOLDER_ARENA } from '@mortal-doctrine/arena/testing';
import type { AudioContextLike, AudioPlayerOptions } from '@mortal-doctrine/audio';
import { createToneBuffers, FIXTURE_CUES } from '@mortal-doctrine/audio/testing';
import type { CameraConfig } from '@mortal-doctrine/camera';
import { FIXTURE_CAMERA_CONFIG } from '@mortal-doctrine/camera/testing';
import { GENERIC_COMMANDS } from '@mortal-doctrine/commands/testing';
import { CORE_EFFECTS, CORE_MAPPING } from '@mortal-doctrine/effects/testing';
import type { FighterState } from '@mortal-doctrine/movement';
import { loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';
import { createInitialState, type InitialStateOptions } from '@mortal-doctrine/simulation';
import type { MatchStageOptions, PresenterOptions } from './index';

/** The fixture every placeholder match starts from. */
export const SEED = 1_180_199;
export const SESSION_OPTIONS = {
  seed: SEED,
  commands: GENERIC_COMMANDS,
} as const satisfies InitialStateOptions;

export const ARENA = parseArena(PLACEHOLDER_ARENA);
/**
 * The arena supplies the camera's visual bounds. The headroom covers the airborne mannequin
 * pose: the raised hand (`grip-right`) is 199 world units above the feet
 * (`tests/headroom.test.ts`) and the 56-unit staff sprite, held 45° from upright, ends about
 * 238 above them.
 */
export const CAMERA_CONFIG: CameraConfig = {
  ...FIXTURE_CAMERA_CONFIG,
  bounds: ARENA.visualBounds,
  headroom: 25_000,
};

const WALK = loadClip(WALK_CYCLE);
const RAISE = loadClip(RAISE_STAFF);
const REST: AnimatedPose = {};
const CROUCH: AnimatedPose = { bones: { root: { scale: { x: 1, y: 0.6 } } } };

type FighterActivity = 'idle' | 'walk' | 'crouch' | 'air';

export function fighterActivity(fighter: FighterState): FighterActivity {
  if (!fighter.grounded) return 'air';
  if (fighter.crouching) return 'crouch';
  return fighter.vx === 0 ? 'idle' : 'walk';
}

/**
 * Placeholder mapping from movement state to a mannequin pose: the walk cycle on the simulation
 * frame while walking, the raised staff in the air, a squash while crouching, the rest pose
 * otherwise. A function of the snapshot only. Not an animation state machine.
 */
export function fighterPose(fighter: FighterState, frame: number): AnimatedPose {
  switch (fighterActivity(fighter)) {
    case 'walk':
      return sample(WALK, frame);
    case 'air':
      return sample(RAISE, RAISE.duration);
    case 'crouch':
      return CROUCH;
    case 'idle':
      return REST;
  }
}

/** `createPresenter` options for the placeholder match; add `audio` and `draw`. */
export const PRESENTATION = {
  camera: CAMERA_CONFIG,
  initial: createInitialState(SESSION_OPTIONS),
  pose: fighterPose,
} as const satisfies Partial<PresenterOptions>;

/**
 * `mountMatchStage` options for the placeholder match. The manifests are the Studio fixtures
 * (`apps/studio/public/fixtures`), which the page's own origin must serve.
 */
export const STAGE: MatchStageOptions = {
  viewport: CAMERA_CONFIG.viewport,
  arena: ARENA,
  arenaManifest: '/fixtures/arena/manifest.json',
  rig: loadRig(MANNEQUIN_RIG),
  skeletonManifest: '/fixtures/skeleton/manifest.json',
  effects: { definitions: CORE_EFFECTS, mapping: CORE_MAPPING },
};

/** `createAudioPlayer` options for the placeholder tone cues; add `gestureTarget`. */
export function toneAudio(context: AudioContextLike) {
  return {
    context,
    cues: FIXTURE_CUES,
    buffers: createToneBuffers(context),
  } satisfies Partial<AudioPlayerOptions>;
}
