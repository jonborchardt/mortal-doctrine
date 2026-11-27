import { int32Schema } from '@mortal-doctrine/sim-core';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case');

const imageSchema = z.strictObject({
  /** Texture id in the arena's asset manifest. */
  texture: z.string().min(1),
  /** Bottom-left corner in authored sub-units, y up. */
  x: int32Schema,
  y: int32Schema,
});

const layerSchema = z.strictObject({
  id,
  /** 1 moves with the gameplay plane, 0 is fixed on screen. */
  parallax: z.number().min(0).max(1),
  images: z.array(imageSchema),
});

const arenaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  /** The authored y drawn at gameplay y = 0. */
  groundLine: int32Schema,
  /** World x the camera may show; its centre is the parallax reference. */
  visualBounds: z
    .strictObject({ left: int32Schema, right: int32Schema })
    .refine(({ left, right }) => right > left, {
      path: ['right'],
      message: 'must be greater than left',
    }),
  /** Back to front. */
  layers: z
    .array(layerSchema)
    .min(1)
    .superRefine((layers, ctx) => {
      layers.forEach((layer, index) => {
        if (layers.findIndex((other) => other.id === layer.id) !== index) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `duplicate layer id "${layer.id}"`,
          });
        }
      });
    }),
});

/** Arena presentation data, `schemaVersion: 1`. Coordinates are integer world sub-units. */
export type Arena = z.infer<typeof arenaSchema>;

/**
 * Validates `schemaVersion: 1` arena presentation data. Throws naming the found and supported
 * versions for another version, or every failing path otherwise.
 */
export function parseArena(json: unknown): Arena {
  const version: unknown =
    typeof json === 'object' && json !== null && 'schemaVersion' in json
      ? json.schemaVersion
      : undefined;
  if (version !== 1) {
    throw new Error(`Unsupported arena schemaVersion ${String(version)}; supported: 1`);
  }
  const result = arenaSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid arena: ${problems.join('; ')}`);
  }
  return result.data;
}
