import { z } from 'zod';

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
const effectIdSchema = z
  .string()
  .regex(
    new RegExp(`^${KEBAB}/${KEBAB}$`),
    'must be "core/<name>" or "<character>/<name>" in kebab-case',
  );

const common = {
  id: effectIdSchema,
  /** Display time from spawn to removal, in ms. */
  lifetimeMs: z.number().positive(),
  /** 0xRRGGBB. */
  colour: z.int().min(0).max(0xffffff),
  /** Sprite diameter or particle side, in world units (logical px at view scale 1). */
  size: z.number().positive(),
};

const effectDefinitionSchema = z.discriminatedUnion('kind', [
  /** One circle that grows from half to full size and fades out. */
  z.strictObject({ kind: z.literal('sprite'), ...common }),
  /** `count` squares moving out from the origin to `distance` world units and fading out. */
  z.strictObject({
    kind: z.literal('particles'),
    ...common,
    count: z.int().positive(),
    distance: z.number().positive(),
  }),
]);
export type EffectDefinition = z.infer<typeof effectDefinitionSchema>;

const definitionsSchema = z.array(effectDefinitionSchema).superRefine((definitions, ctx) => {
  const seen = new Set<string>();
  definitions.forEach(({ id }, index) => {
    if (seen.has(id)) {
      ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `duplicate effect id "${id}"` });
    }
    seen.add(id);
  });
});

/** Validates effect definitions. Throws naming the offending field (e.g. `1.lifetimeMs`). */
export function parseEffectDefinitions(json: unknown): EffectDefinition[] {
  const result = definitionsSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid effect definitions: ${describe(result.error)}`);
  return result.data;
}

const mappingSchema = z.record(
  z.string().min(1),
  z.strictObject({
    effect: effectIdSchema,
    /** Added to the fighter's position, in sub-units. */
    offset: z.strictObject({ x: z.int(), y: z.int() }).optional(),
  }),
);
/** Event `type` → the effect it spawns. */
export type EffectMapping = z.infer<typeof mappingSchema>;

/**
 * Validates an event-type → effect mapping against `definitions`. Throws naming the entry
 * (e.g. `land.effect: unknown effect "core/missing"`).
 */
export function parseEffectMapping(
  json: unknown,
  definitions: readonly EffectDefinition[],
): EffectMapping {
  const ids = new Set(definitions.map(({ id }) => id));
  const result = mappingSchema
    .superRefine((mapping, ctx) => {
      for (const [type, { effect }] of Object.entries(mapping)) {
        if (!ids.has(effect)) {
          ctx.addIssue({
            code: 'custom',
            path: [type, 'effect'],
            message: `unknown effect "${effect}"`,
          });
        }
      }
    })
    .safeParse(json);
  if (!result.success) throw new Error(`Invalid effect mapping: ${describe(result.error)}`);
  return result.data;
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
