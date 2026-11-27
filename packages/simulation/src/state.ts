import { z } from 'zod';

export const fighterStateSchema = z.object({ x: z.int() }).readonly();

export const simulationStateSchema = z
  .object({
    frame: z.int().nonnegative(),
    fighters: z.tuple([fighterStateSchema, fighterStateSchema]).readonly(),
  })
  .readonly();

export type FighterState = z.infer<typeof fighterStateSchema>;
export type SimulationState = z.infer<typeof simulationStateSchema>;

export interface PlayerInput {
  readonly left: boolean;
  readonly right: boolean;
}

export type FrameInputs = readonly [PlayerInput, PlayerInput];

export const NEUTRAL_INPUT: PlayerInput = { left: false, right: false };

export function createInitialState(): SimulationState {
  return { frame: 0, fighters: [{ x: 240 }, { x: 720 }] };
}

export function serializeState(state: SimulationState): string {
  return JSON.stringify(state);
}

/** Parses and validates serialized state. Throws on malformed input. */
export function deserializeState(json: string): SimulationState {
  return simulationStateSchema.parse(JSON.parse(json));
}
