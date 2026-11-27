import { z } from 'zod';

const texturePath = z
  .string()
  .min(1)
  .refine((path) => !path.includes('\\'), 'must use forward slashes')
  .refine(
    (path) => !path.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(path),
    'must be relative to the manifest',
  )
  // URL resolution treats `%2e` as `.`, so percent-encoded dot segments are parents too.
  .refine(
    (path) => !path.split('/').some((segment) => /^(?:\.|%2e){2}$/i.test(segment)),
    'must not contain ".."',
  );

const textureManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  textures: z.record(z.string().min(1), texturePath),
});

/**
 * Validates a `schemaVersion: 1` asset manifest (`docs/content-conventions.md`) and resolves each
 * texture path against the absolute `manifestUrl`. Returns texture id → absolute URL. Throws
 * naming the offending field or texture id.
 */
export function parseTextureManifest(json: unknown, manifestUrl: string): Record<string, string> {
  const version: unknown =
    typeof json === 'object' && json !== null && 'schemaVersion' in json
      ? json.schemaVersion
      : undefined;
  if (version !== 1) {
    throw new Error(
      `Unsupported asset manifest schemaVersion ${String(version)} in ${manifestUrl}; supported: 1`,
    );
  }
  const result = textureManifestSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid asset manifest ${manifestUrl}: ${problems.join('; ')}`);
  }
  return Object.fromEntries(
    Object.entries(result.data.textures).map(([id, path]) => [id, new URL(path, manifestUrl).href]),
  );
}
