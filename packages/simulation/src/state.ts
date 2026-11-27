import {
  commandsSliceSchema,
  createCommandsSlice,
  requiredHistory,
  type CommandDefinition,
} from '@mortal-doctrine/commands';
import { int32Schema } from '@mortal-doctrine/sim-core';
import { z } from 'zod';
import { fightersSliceSchema, initialFighters } from './fighters';
import { initialInput, inputSliceSchema } from './input';
import { initialRng, rngSliceSchema } from './rng';

/** Composition of the slices; each slice's schema lives with its owning module. */
export const simulationStateSchema = z
  .object({
    frame: int32Schema.nonnegative(),
    rng: rngSliceSchema,
    input: inputSliceSchema,
    fighters: fightersSliceSchema,
    commands: commandsSliceSchema,
  })
  .superRefine((state, ctx) => {
    state.commands.definitions.forEach((definition, index) => {
      if (requiredHistory(definition) > state.input.capacity) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', 'definitions', index],
          message: `needs ${requiredHistory(definition)} history frames, more than capacity ${state.input.capacity}`,
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
}

export function createInitialState(options: InitialStateOptions = {}): SimulationState {
  const input = initialInput(options.historyCapacity);
  return {
    frame: 0,
    rng: initialRng(options.seed),
    input,
    fighters: initialFighters(),
    commands: createCommandsSlice(options.commands ?? [], input.capacity),
  };
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
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${['state', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid simulation state: ${problems.join('; ')}`);
  }
  return result.data;
}
