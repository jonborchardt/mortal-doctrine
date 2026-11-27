import { frameInputsSchema } from '@mortal-doctrine/sim-core';
import { MAX_HISTORY_CAPACITY } from '@mortal-doctrine/simulation';
import { z } from 'zod';

export const REPLAY_VERSION = 1;

const hashSchema = z.string().regex(/^[0-9a-f]{8}$/, 'expected 8 lowercase hex digits');

const checksumSchema = z
  .object({
    /** The state before tick `frame` runs, i.e. after `inputs[0..frame)`. */
    frame: z.int().min(0),
    stateHash: hashSchema,
    inputsHash: hashSchema,
  })
  .readonly();

export const replaySchema = z
  .object({
    replayVersion: z.literal(REPLAY_VERSION),
    /** `createInitialState` options, always explicit. */
    options: z
      .object({
        seed: z.int().min(0).max(0xffff_ffff),
        historyCapacity: z.int().min(1).max(MAX_HISTORY_CAPACITY),
      })
      .readonly(),
    checksumInterval: z.int().min(1),
    /** The complete input stream: `inputs[f]` is what tick `f` was stepped with. */
    inputs: z.array(frameInputsSchema).readonly(),
    checksums: z.array(checksumSchema).readonly(),
  })
  .superRefine((replay, ctx) => {
    const { checksums, inputs } = replay;
    const issue = (index: number, message: string) =>
      ctx.addIssue({ code: 'custom', path: ['checksums', index, 'frame'], message });
    checksums.forEach(({ frame }, index) => {
      if (frame > inputs.length) {
        issue(index, `frame ${frame} is outside 0..${inputs.length}`);
      }
      const previous = checksums[index - 1];
      if (previous && frame <= previous.frame) {
        issue(index, `frame ${frame} does not ascend from ${previous.frame}`);
      }
    });
    const last = checksums.at(-1);
    if (!last) {
      ctx.addIssue({ code: 'custom', path: ['checksums'], message: 'needs at least one checksum' });
    } else if (last.frame !== inputs.length) {
      issue(
        checksums.length - 1,
        `last checksum frame ${last.frame} must equal the input count ${inputs.length}`,
      );
    }
  })
  .readonly();

export type Replay = z.infer<typeof replaySchema>;
export type ReplayChecksum = z.infer<typeof checksumSchema>;

export function serializeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

/**
 * Parses and validates replay JSON. Throws on text that is not JSON, on an unknown
 * `replayVersion` (naming found and supported) and on schema failures (naming the failing path).
 */
export function deserializeReplay(json: string): Replay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(`Replay is not valid JSON: ${String(cause)}`, { cause });
  }
  const envelope: object = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const version: unknown = 'replayVersion' in envelope ? envelope.replayVersion : undefined;
  if (version !== REPLAY_VERSION) {
    throw new Error(
      `Unsupported replayVersion ${JSON.stringify(version) ?? 'undefined'}; supported: ${REPLAY_VERSION}`,
    );
  }
  const result = replaySchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${['replay', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid replay: ${problems.join('; ')}`);
  }
  return result.data;
}
