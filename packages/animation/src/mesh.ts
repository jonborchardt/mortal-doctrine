import { apply, invert, type Vec2 } from '@mortal-doctrine/math';
import { evaluate, type EvaluatedRig, type Rig } from '@mortal-doctrine/rig';
import { z } from 'zod';

export const MESH_SCHEMA_VERSION = 1;
/** The most bones one vertex may be weighted to. */
export const MAX_INFLUENCES = 4;
/** How far a vertex's weights may sum from 1. */
export const WEIGHT_TOLERANCE = 1e-6;

const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  error: (issue) => `id ${JSON.stringify(issue.input)} must be kebab-case`,
});
const vec2Schema = z.object({ x: z.number(), y: z.number() }).readonly();

/**
 * The authored form of a mesh attachment. Positions are in rig space at the rig's rest pose
 * (world units, y-up), which is the bind pose. `loadMesh` turns it into a runtime {@link Mesh}.
 */
export const meshDataSchema = z
  .object({
    schemaVersion: z.literal(MESH_SCHEMA_VERSION),
    /** The rig attachment this mesh draws. */
    attachment: idSchema,
    vertices: z
      .array(
        z
          .object({
            position: vec2Schema,
            /** Texture coordinates in [0, 1], v down. */
            uv: vec2Schema,
            weights: z
              .array(z.object({ bone: idSchema, weight: z.number() }).readonly())
              .readonly(),
          })
          .readonly(),
      )
      .readonly(),
    /** Vertex indices, three per triangle. */
    triangles: z.array(z.tuple([z.number(), z.number(), z.number()]).readonly()).readonly(),
  })
  .readonly();

export type MeshData = z.infer<typeof meshDataSchema>;

/** The runtime form of a mesh, built only by {@link loadMesh} for one rig. */
export interface Mesh {
  /** The id of the rig it was loaded for. */
  readonly rig: string;
  readonly attachment: string;
  readonly vertices: readonly {
    readonly position: Vec2;
    readonly uv: Vec2;
    readonly weights: readonly {
      readonly bone: string;
      /** The bone's index in `rig.bones`, which is also its index in `evaluate(...).bones`. */
      readonly index: number;
      readonly weight: number;
      /** `inverse(boneWorld(rest)) · position`: the vertex in the bone's rest space. */
      readonly local: Vec2;
    }[];
  }[];
  readonly triangles: readonly (readonly [number, number, number])[];
}

/**
 * Validates authored mesh data against `rig` and precomputes each weight's inverse-bind
 * position. Throws one error listing every problem found.
 */
export function loadMesh(rig: Rig, data: unknown): Mesh {
  const version: unknown =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  if (version !== MESH_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported mesh schemaVersion ${JSON.stringify(version)}; supported: ${MESH_SCHEMA_VERSION}`,
    );
  }
  const result = meshDataSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${['mesh', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid mesh: ${problems.join('; ')}`);
  }
  const { attachment, vertices, triangles } = result.data;

  const problems: string[] = [];
  if (!rig.attachments.some(({ id }) => id === attachment)) {
    problems.push(`unknown attachment "${attachment}" of rig "${rig.id}"`);
  }
  if (vertices.length < 3) problems.push(`has ${vertices.length} vertices, needs at least 3`);
  if (triangles.length === 0) problems.push('has no triangles');

  const rest = evaluate(rig, {}).bones;
  const inverses = rest.map(({ transform }) => invert(transform));
  const loaded = vertices.map(({ position, uv, weights }, v) => {
    if (weights.length === 0) problems.push(`vertex ${v} has no weights`);
    if (weights.length > MAX_INFLUENCES) {
      problems.push(`vertex ${v} has ${weights.length} weights, at most ${MAX_INFLUENCES} allowed`);
    }
    if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) {
      problems.push(`vertex ${v} uv (${uv.x}, ${uv.y}) is outside [0, 1]`);
    }
    const sum = weights.reduce((total, { weight }) => total + weight, 0);
    if (weights.length > 0 && Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
      problems.push(`vertex ${v} weights sum to ${sum}, not 1 (tolerance ${WEIGHT_TOLERANCE})`);
    }
    const seen = new Set<string>();
    const skinned = weights.flatMap(({ bone, weight }) => {
      if (seen.has(bone)) problems.push(`vertex ${v} names bone "${bone}" twice`);
      seen.add(bone);
      if (weight <= 0)
        problems.push(`vertex ${v} weight ${weight} for bone "${bone}" is not positive`);
      const index = rest.findIndex(({ id }) => id === bone);
      if (index < 0) {
        problems.push(`vertex ${v} names unknown bone "${bone}" of rig "${rig.id}"`);
        return [];
      }
      const inverse = inverses[index];
      if (!inverse) {
        problems.push(
          `vertex ${v} is weighted to bone "${bone}", whose rest world transform is not invertible`,
        );
        return [];
      }
      return [{ bone, index, weight, local: apply(inverse, position) }];
    });
    return { position, uv, weights: skinned };
  });

  triangles.forEach((triangle, t) => {
    for (const index of triangle) {
      if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
        problems.push(
          `triangle ${t} index ${index} is not a vertex index (integer in [0, ${vertices.length - 1}])`,
        );
      }
    }
    if (new Set(triangle).size < 3) problems.push(`triangle ${t} repeats an index`);
  });

  if (problems.length > 0) {
    throw new Error(`Invalid mesh "${attachment}": ${problems.join('; ')}`);
  }
  return { rig: rig.id, attachment, vertices: loaded, triangles };
}

/**
 * Linear blend skinning: each vertex is the weighted sum of `boneWorld(pose) · local` over its
 * weights. `bones` is `evaluate(rig, pose).bones` for the mesh's rig. Returns rig-space
 * positions (world units, y-up), one per vertex. Pure; throws when `bones` is not of that rig.
 */
export function skin(mesh: Mesh, bones: EvaluatedRig['bones']): Vec2[] {
  return mesh.vertices.map(({ weights }) => {
    let x = 0;
    let y = 0;
    for (const { bone, index, weight, local } of weights) {
      const evaluated = bones[index];
      if (evaluated?.id !== bone) {
        throw new Error(`Mesh "${mesh.attachment}": bones are not of rig "${mesh.rig}"`);
      }
      const p = apply(evaluated.transform, local);
      x += weight * p.x;
      y += weight * p.y;
    }
    return { x, y };
  });
}
