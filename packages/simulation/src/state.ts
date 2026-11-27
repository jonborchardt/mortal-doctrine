import {
  commandsSliceSchema,
  createCommandsSlice,
  requiredHistory,
  type CommandDefinition,
} from '@mortal-doctrine/commands';
import {
  arenaRulesSchema,
  DEFAULT_ARENA_RULES,
  DEFAULT_MOVEMENT_PARAMETERS,
  initialMovement,
  movementSliceSchema,
  widestPushboxWidth,
  type ArenaRules,
  type MovementParameters,
} from '@mortal-doctrine/movement';
import { int32Schema } from '@mortal-doctrine/sim-core';
import { z } from 'zod';
import { initialInput, inputSliceSchema } from './input';
import { initialRng, rngSliceSchema } from './rng';

/** Composition of the slices; each slice's schema lives with its owning module. */
export const simulationStateSchema = z
  .object({
    frame: int32Schema.nonnegative(),
    rng: rngSliceSchema,
    input: inputSliceSchema,
    arena: arenaRulesSchema,
    fighters: movementSliceSchema,
    commands: commandsSliceSchema,
  })
  .superRefine((state, ctx) => {
    // The arena must fit both fighters' widest pushboxes side by side, and a separation limit
    // must leave room for them not to overlap.
    const [w0, w1] = state.fighters.map((fighter) => widestPushboxWidth(fighter.params));
    const widthSum = (w0 ?? 0) + (w1 ?? 0);
    const halfWidthSum = widthSum / 2;
    if (state.arena.width < widthSum) {
      ctx.addIssue({
        code: 'custom',
        path: ['arena', 'width'],
        message: `must be at least ${widthSum}, the sum of both fighters' widest pushbox widths`,
      });
    }
    const { maxSeparation } = state.arena;
    if (maxSeparation !== undefined && maxSeparation <= halfWidthSum) {
      ctx.addIssue({
        code: 'custom',
        path: ['arena', 'maxSeparation'],
        message: `must be greater than ${halfWidthSum}, the sum of both fighters' widest pushbox half-widths`,
      });
    }
    state.commands.definitions.forEach((definition, index) => {
      if (requiredHistory(definition) > state.input.capacity) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', 'definitions', index],
          message: `needs ${requiredHistory(definition)} history frames, more than historyCapacity ${state.input.capacity}`,
        });
      }
    });
  })
  .readonly();

export type SimulationState = z.infer<typeof simulationStateSchema>;

export interface InitialStateOptions {
  /** RNG seed, an integer in [0, 2^32 - 1]. Default 0. */
  readonly seed?: number;
  /** Input history frames kept per player, an integer in [1, 600]. Default 60. */
  readonly historyCapacity?: number;
  /**
   * Command definitions for both players, in priority order (`@mortal-doctrine/commands`).
   * Default none. Throws naming the failing path, or if one needs more than `historyCapacity`.
   */
  readonly commands?: readonly CommandDefinition[];
  /**
   * Movement parameters for player 0 and player 1 (`@mortal-doctrine/movement`). Default
   * `DEFAULT_MOVEMENT_PARAMETERS` for both.
   */
  readonly movement?: readonly [MovementParameters, MovementParameters];
  /** Gameplay arena rules. Default `DEFAULT_ARENA_RULES` (width 96000, no separation limit). */
  readonly arena?: ArenaRules;
}

/**
 * Builds and validates the initial state: fighters standing `width / 2` apart (x 24000 and
 * 72000 by default; closer if `maxSeparation` is smaller), facing each other. Throws naming the
 * failing path for invalid options.
 */
export function createInitialState(options: InitialStateOptions = {}): SimulationState {
  const input = initialInput(options.historyCapacity);
  const commands = createCommandsSlice(options.commands ?? [], input.capacity);
  const params = options.movement ?? [DEFAULT_MOVEMENT_PARAMETERS, DEFAULT_MOVEMENT_PARAMETERS];
  // Positions derive from the arena, so a malformed arena is reported before they are computed.
  const arenaResult = arenaRulesSchema.safeParse(options.arena ?? DEFAULT_ARENA_RULES);
  if (!arenaResult.success) throw invalid(arenaResult.error, 'arena');
  const arena = arenaResult.data;
  const result = simulationStateSchema.safeParse({
    frame: 0,
    rng: initialRng(options.seed),
    input,
    arena,
    fighters: initialMovement(params, arena),
    commands,
  });
  if (!result.success) throw invalid(result.error, 'state');
  return result.data;
}

function invalid(error: z.ZodError, root: string): Error {
  const problems = error.issues.map(
    (issue) => `${[root, ...issue.path.map(String)].join('.')}: ${issue.message}`,
  );
  return new Error(`Invalid simulation state: ${problems.join('; ')}`);
}

export const SCHEMA_VERSION = 1;

/** JSON of `{ schemaVersion: 1, state }`. */
export function serializeState(state: SimulationState): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, state });
}

/**
 * Parses and validates serialized state. Throws, naming the found and supported version or the
 * failing path; never returns partially restored state.
 */
export function deserializeState(json: string): SimulationState {
  const parsed: unknown = JSON.parse(json);
  const envelope: object = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const version: unknown = 'schemaVersion' in envelope ? envelope.schemaVersion : undefined;
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported simulation state schemaVersion ${String(version)}; supported: ${SCHEMA_VERSION}`,
    );
  }
  const result = simulationStateSchema.safeParse('state' in envelope ? envelope.state : undefined);
  if (!result.success) throw invalid(result.error, 'state');
  return result.data;
}
