import {
  InputBit,
  int32Schema,
  NEUTRAL_INPUT,
  resolveDirection,
  type InputFrame,
  type SimulationEventEnvelope,
} from '@mortal-doctrine/sim-core';
import { z } from 'zod';
import {
  commandListSchema,
  parseCommandList,
  requiredHistory,
  type CommandDefinition,
  type Direction,
} from './definition';

/** Which way a player faces; `forward` is toward that side. */
export type Facing = 'right' | 'left';

/**
 * Per charge definition: `run` = consecutive frames ending now held in the charge direction
 * (saturates at `charge.frames`); `since` = frames since `run` last reached `charge.frames`
 * (0 = this frame; saturates at `maxFrames + 1`, meaning "not charged").
 */
const chargeCounterSchema = z
  .object({ run: int32Schema.nonnegative(), since: int32Schema.nonnegative() })
  .readonly();
const playerCountersSchema = z.array(chargeCounterSchema.nullable()).readonly();

export const commandsSliceSchema = z
  .object({
    definitions: commandListSchema,
    /** Per player, one entry per definition: a counter for charge definitions, else `null`. */
    charges: z.tuple([playerCountersSchema, playerCountersSchema]).readonly(),
  })
  .superRefine((slice, ctx) => {
    slice.charges.forEach((counters, player) => {
      if (counters.length !== slice.definitions.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['charges', player],
          message: `has ${counters.length} entries for ${slice.definitions.length} definitions`,
        });
        return;
      }
      counters.forEach((counter, index) => {
        if ((counter === null) !== (slice.definitions[index]?.charge === undefined)) {
          ctx.addIssue({
            code: 'custom',
            path: ['charges', player, index],
            message: 'must be a counter exactly when the definition has a charge',
          });
        }
      });
    });
  })
  .readonly();

export type CommandsSlice = z.infer<typeof commandsSliceSchema>;
type ChargeCounter = z.infer<typeof chargeCounterSchema>;

/** A definition recognized for `player` on the processed `frame`. */
export interface CommandEvent extends SimulationEventEnvelope<'command'> {
  readonly player: 0 | 1;
  /** The definition's `id`. */
  readonly command: string;
}

export interface CommandsContext {
  readonly frame: number;
  /** Raw frames per player, oldest first, already holding this tick's frame. */
  readonly histories: readonly [readonly InputFrame[], readonly InputFrame[]];
  readonly facing: readonly [Facing, Facing];
}

/**
 * Validates `definitions` and builds the initial slice. Throws naming the failing path, or when a
 * definition reads more frames than `historyCapacity` keeps (a charge's `frames` does not count).
 */
export function createCommandsSlice(definitions: unknown, historyCapacity: number): CommandsSlice {
  const list = parseCommandList(definitions);
  list.forEach((definition, index) => {
    const needed = requiredHistory(definition);
    if (needed > historyCapacity) {
      throw new RangeError(
        `commands.${index} ("${definition.id}") needs ${needed} history frames, more than historyCapacity ${historyCapacity}`,
      );
    }
  });
  const counters = list.map((definition) =>
    definition.charge ? { run: 0, since: definition.maxFrames + 1 } : null,
  );
  return { definitions: list, charges: [counters, counters] };
}

// [y + 1][forward + 1]
const DIRECTION_NAMES: readonly (readonly Direction[])[] = [
  ['down-back', 'down', 'down-forward'],
  ['back', 'neutral', 'forward'],
  ['up-back', 'up', 'up-forward'],
];

const NO_EVENTS: readonly CommandEvent[] = Object.freeze([]);

/**
 * Recognizes every definition for this frame. Events: player 0 before player 1, then definition
 * order. Nothing is consumed: several commands can fire on one frame.
 */
export function updateCommands(
  slice: CommandsSlice,
  context: CommandsContext,
): { readonly slice: CommandsSlice; readonly events: readonly CommandEvent[] } {
  if (slice.definitions.length === 0) return { slice, events: NO_EVENTS };
  const events: CommandEvent[] = [];
  const recognize = (player: 0 | 1) => {
    const history = context.histories[player];
    const sign = context.facing[player] === 'right' ? 1 : -1;
    // Before the first recorded frame nothing was held (definitions fit the capacity).
    const at = (ago: number): InputFrame => history[history.length - 1 - ago] ?? NEUTRAL_INPUT;
    const relative = (ago: number) => {
      const { x, y } = resolveDirection(at(ago));
      return { forward: x * sign, y };
    };
    const now = relative(0);
    return slice.definitions.map((definition, index) => {
      const previous = slice.charges[player][index];
      const counter = previous ? nextCharge(previous, definition, now) : null;
      if (
        triggered(definition, at) &&
        (!counter || counter.since <= definition.maxFrames) &&
        motionMatches(definition, history.length, (ago) => {
          const { forward, y } = relative(ago);
          return DIRECTION_NAMES[y + 1]?.[forward + 1];
        })
      ) {
        events.push(
          Object.freeze({ type: 'command', frame: context.frame, player, command: definition.id }),
        );
      }
      return counter;
    });
  };
  const charges = [recognize(0), recognize(1)] as const;
  return { slice: { definitions: slice.definitions, charges }, events };
}

function nextCharge(
  counter: ChargeCounter,
  definition: CommandDefinition,
  now: { readonly forward: number; readonly y: number },
): ChargeCounter {
  const charge = definition.charge;
  if (!charge) return counter;
  const held = {
    forward: now.forward === 1,
    back: now.forward === -1,
    up: now.y === 1,
    down: now.y === -1,
  }[charge.direction];
  const run = held ? Math.min(counter.run + 1, charge.frames) : 0;
  const since = run === charge.frames ? 0 : Math.min(counter.since + 1, definition.maxFrames + 1);
  return { run, since };
}

/** Press: every button held, at least one pressed now, all pressed within the chord window. */
function triggered(definition: CommandDefinition, at: (ago: number) => InputFrame): boolean {
  const { buttons, edge, chordWindow } = definition.trigger;
  if (edge === 'release') {
    const [button] = buttons;
    if (!button) return false;
    const bit = InputBit[button];
    return (at(1) & bit) !== 0 && (at(0) & bit) === 0;
  }
  const maxAge = buttons.length > 1 ? chordWindow : 0;
  let pressedNow = false;
  for (const button of buttons) {
    const bit = InputBit[button];
    if ((at(0) & bit) === 0) return false;
    let age = 0;
    while ((at(age + 1) & bit) !== 0) {
      age += 1;
      if (age > maxAge) return false;
    }
    if (age === 0) pressedNow = true;
  }
  return pressedNow;
}

function motionMatches(
  definition: CommandDefinition,
  recorded: number,
  direction: (ago: number) => Direction | undefined,
): boolean {
  const motion = definition.motion;
  if (!motion) return true;
  let next = 0;
  for (let ago = Math.min(definition.maxFrames, recorded) - 1; ago >= 0; ago--) {
    if (direction(ago) === motion[next] && ++next === motion.length) return true;
  }
  return false;
}
