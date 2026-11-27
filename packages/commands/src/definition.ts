import { z } from 'zod';

/** The nine facing-relative directions a motion step can name. */
export const directionSchema = z.enum([
  'neutral',
  'forward',
  'back',
  'up',
  'down',
  'up-forward',
  'up-back',
  'down-forward',
  'down-back',
]);
export type Direction = z.infer<typeof directionSchema>;

export const buttonSchema = z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
export type Button = z.infer<typeof buttonSchema>;

const positiveFrames = z.int32().positive();

const triggerSchema = z
  .strictObject({
    /** Press: a chord when there are several. Release: exactly one. */
    buttons: z.array(buttonSchema).min(1).readonly(),
    edge: z.enum(['press', 'release']),
    /** Max frames between the first and last press edge of a chord (0 = same frame). */
    chordWindow: z.int32().nonnegative(),
  })
  .superRefine((trigger, ctx) => {
    trigger.buttons.forEach((button, index) => {
      if (trigger.buttons.indexOf(button) !== index) {
        ctx.addIssue({ code: 'custom', path: ['buttons', index], message: `duplicate ${button}` });
      }
    });
    if (trigger.edge === 'release' && trigger.buttons.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['buttons'],
        message: 'a release trigger takes exactly one button',
      });
    }
  })
  .readonly();

export const commandDefinitionSchema = z
  .strictObject({
    id: z.string().min(1),
    /** Steps in order, not necessarily adjacent, within the last `maxFrames` frames. */
    motion: z.array(directionSchema).min(1).readonly().optional(),
    /** A cardinal held for `frames` consecutive frames, last held at most `maxFrames` ago. */
    charge: z
      .strictObject({
        direction: z.enum(['forward', 'back', 'up', 'down']),
        frames: positiveFrames,
      })
      .readonly()
      .optional(),
    trigger: triggerSchema,
    /** Motion window and charge release gap, current frame included. Unused otherwise. */
    maxFrames: positiveFrames,
  })
  .readonly();

export type CommandDefinition = z.infer<typeof commandDefinitionSchema>;

/** Definitions in priority order (earliest first); ids are unique. */
export const commandListSchema = z
  .array(commandDefinitionSchema)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((definition, index) => {
      if (seen.has(definition.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate id "${definition.id}"`,
        });
      }
      seen.add(definition.id);
    });
  })
  .readonly();

/** Input-history frames a definition reads (its own window, or the trigger's edge lookback). */
export function requiredHistory(definition: CommandDefinition): number {
  const { buttons, chordWindow } = definition.trigger;
  return Math.max(definition.maxFrames, (buttons.length > 1 ? chordWindow : 0) + 2);
}

/** Returns `value` as a definition list or throws a `TypeError` naming every failing path. */
export function parseCommandList(value: unknown): readonly CommandDefinition[] {
  const result = commandListSchema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${['commands', ...issue.path.map(String)].join('.')}: ${issue.message}`,
  );
  throw new TypeError(`Invalid command definitions: ${problems.join('; ')}`);
}
