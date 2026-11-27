import { degToRad } from '@mortal-doctrine/math';
import { z } from 'zod';

export const CLIP_SCHEMA_VERSION = 1;

const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  error: (issue) => `id ${JSON.stringify(issue.input)} must be kebab-case`,
});
const vec2Schema = z.object({ x: z.number(), y: z.number() }).readonly();
const frameSchema = z.int().min(0);

const unit = z.number().min(0).max(1);
/**
 * How a key's value moves toward the next key's. `bezier` is a CSS-style cubic easing curve
 * `[x1, y1, x2, y2]` from (0, 0) to (1, 1); x1 and x2 must be in [0, 1].
 */
const interpolationSchema = z.union(
  [
    z.literal('step'),
    z.literal('linear'),
    z.object({ bezier: z.tuple([unit, z.number(), unit, z.number()]).readonly() }).readonly(),
  ],
  {
    error:
      'interpolation must be "step", "linear" or { bezier: [x1, y1, x2, y2] } with x1 and x2 in [0, 1]',
  },
);

const keysSchema = <T extends z.ZodType>(value: T) =>
  z
    .array(
      z
        .object({
          /** Integer frame at 60 Hz. */
          frame: frameSchema,
          value,
          /** Governs the segment from this key to the next. */
          interpolation: interpolationSchema.default('linear'),
        })
        .readonly(),
    )
    .min(1)
    .readonly();

/**
 * The authored form of a clip: rotations in degrees, key frames in integer frames at 60 Hz.
 * `loadClip` turns it into a runtime {@link Clip}.
 */
export const clipDataSchema = z
  .object({
    schemaVersion: z.literal(CLIP_SCHEMA_VERSION),
    id: idSchema,
    /** Length in frames. */
    duration: z.int().min(1),
    loop: z.boolean(),
    /** Channels by bone id. Each channel's keys are in strictly ascending frame order. */
    bones: z
      .record(
        idSchema,
        z
          .object({
            /** Degrees. */
            rotation: keysSchema(z.number()).optional(),
            translation: keysSchema(vec2Schema).optional(),
            scale: keysSchema(vec2Schema).optional(),
          })
          .readonly(),
      )
      .readonly()
      .default({}),
    /** Attachment switch keys by slot id; `null` shows none. */
    attachments: z
      .record(
        idSchema,
        z
          .array(z.object({ frame: frameSchema, attachment: idSchema.nullable() }).readonly())
          .min(1)
          .readonly(),
      )
      .readonly()
      .default({}),
    /** Draw-order keys: slot ids, back to front. */
    drawOrder: z
      .array(z.object({ frame: frameSchema, slots: z.array(idSchema).readonly() }).readonly())
      .readonly()
      .default([]),
  })
  .readonly();

/** What authors write: `interpolation`, `bones`, `attachments` and `drawOrder` may be omitted. */
export type ClipData = z.input<typeof clipDataSchema>;

/** The runtime form of a clip, built only by {@link loadClip}. Rotations in radians. */
export type Clip = Omit<z.output<typeof clipDataSchema>, 'schemaVersion'>;

export type Interpolation = z.output<typeof interpolationSchema>;

export interface Key<T> {
  readonly frame: number;
  readonly value: T;
  readonly interpolation: Interpolation;
}

/**
 * Validates authored clip data (schema, then key frames) and converts it to the runtime form.
 * This is the only place degrees become radians. Throws one error listing every problem found.
 * It does not check the clip against a rig: `evaluate` rejects unknown bones and slots.
 */
export function loadClip(data: unknown): Clip {
  const version: unknown =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  if (version !== CLIP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported clip schemaVersion ${JSON.stringify(version)}; supported: ${CLIP_SCHEMA_VERSION}`,
    );
  }
  const result = clipDataSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${['clip', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid clip: ${problems.join('; ')}`);
  }
  const clip = result.data;

  const problems: string[] = [];
  const checkFrames = (what: string, keys: readonly { readonly frame: number }[]) => {
    keys.forEach(({ frame }, index) => {
      if (frame > clip.duration) {
        problems.push(`${what} key frame ${frame} is beyond duration ${clip.duration}`);
      }
      const previous = keys[index - 1];
      if (previous && frame <= previous.frame) {
        problems.push(
          `${what} key frames must be strictly ascending (${frame} follows ${previous.frame})`,
        );
      }
    });
  };
  for (const [bone, channels] of Object.entries(clip.bones)) {
    for (const [channel, keys] of Object.entries(channels)) {
      if (keys) checkFrames(`bone "${bone}" ${channel}`, keys);
    }
  }
  for (const [slot, keys] of Object.entries(clip.attachments)) {
    checkFrames(`slot "${slot}" attachment`, keys);
  }
  checkFrames('draw-order', clip.drawOrder);
  for (const { frame, slots } of clip.drawOrder) {
    if (new Set(slots).size !== slots.length) {
      problems.push(`draw-order key at frame ${frame} lists a slot twice`);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid clip "${clip.id}": ${problems.join('; ')}`);

  return {
    id: clip.id,
    duration: clip.duration,
    loop: clip.loop,
    attachments: clip.attachments,
    drawOrder: clip.drawOrder,
    bones: Object.fromEntries(
      Object.entries(clip.bones).map(([bone, { rotation, ...channels }]) => [
        bone,
        rotation
          ? { ...channels, rotation: rotation.map((k) => ({ ...k, value: degToRad(k.value) })) }
          : channels,
      ]),
    ),
  };
}

/** Authoring helper: one key. `interpolation` governs the segment to the next key. */
export function key<T>(frame: number, value: T, interpolation: Interpolation = 'linear'): Key<T> {
  return { frame, value, interpolation };
}

/** Authoring helper: clip data with the current `schemaVersion`; pass the result to `loadClip`. */
export function defineClip(
  id: string,
  duration: number,
  content: Pick<ClipData, 'bones' | 'attachments' | 'drawOrder'> & { readonly loop?: boolean },
): ClipData {
  return { schemaVersion: CLIP_SCHEMA_VERSION, id, duration, loop: false, ...content };
}
