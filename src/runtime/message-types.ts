import type { CasePriority, LinkType, Parameter } from '../shared/types.js';

/**
 * The message set carried by the metadata side-channel.
 *
 * Each `qualflare.*()` call (see `qualflare-api.ts`) becomes one of these,
 * appended as NDJSON in the test WORKER and replayed in the reporter, which
 * runs in the MAIN process — see `channel.ts` for why that boundary exists and
 * how it is crossed. There is no `task.meta` here and no RPC; that is Vitest's
 * transport, and this file used to describe it by mistake.
 *
 * Every field must survive JSON: the channel is a file, so anything
 * unserializable is silently lost rather than rejected.
 *
 * `step_start`/`step_stop` are deliberately a flat PAIR rather than a nested
 * structure. An append-only channel cannot express nesting directly, but the
 * arrival order of the pairs reconstructs it exactly — `case-builder.ts` walks
 * the stream with a stack and recovers `parentIndex`.
 */
export type RuntimeMessage =
  | { type: 'label'; name: string; value: string }
  | { type: 'link'; url: string; linkType?: LinkType; name?: string }
  | { type: 'tag'; tags: string[] }
  | { type: 'description'; text: string }
  | { type: 'priority'; value: CasePriority }
  | { type: 'parameter'; name: string; value?: string; masked?: boolean }
  | { type: 'attachment'; name: string; contentBase64: string; mimeType?: string }
  | { type: 'attachment_from_file'; name: string; path: string; mimeType?: string }
  | { type: 'step_start'; name: string; timestamp: number }
  | { type: 'step_stop'; status: 'passed' | 'failed'; error?: string; timestamp: number };

/** One `qualflare.step()` call, fully resolved (both `step_start` and
 * `step_stop` messages applied) — mirrors `@qualflare/cypress`'s
 * `ManualStepRecord` shape for cross-package consistency. Timing here is
 * EXACT (real `Date.now()` deltas around an `await`ed step body), unlike
 * Cypress's documented approximation. */
export interface ManualStepRecord {
  name: string;
  status: 'passed' | 'failed';
  error?: string;
  parentIndex?: number;
  parameters?: Parameter[];
  startedAt: number;
  durationMs?: number;
}
