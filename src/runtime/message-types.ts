import type { CasePriority, LinkType, Parameter } from '../shared/types.js';

/**
 * `qualflare.*()` calls (see `qualflare-api.ts`) are fire-and-forget: each one
 * is pushed onto `task.meta[QUALFLARE_META_KEY]` in the test worker, which
 * Vitest serializes over RPC and the reporter reads back as
 * `testCase.meta()`. Accumulation is therefore worker-side (a plain array on
 * the task) and replay is reporter-side, in `reporter/case-builder.ts`'s
 * `replayMetadata`.
 *
 * Every field must survive JSON — `task.meta` crosses a process boundary, so
 * anything unserializable is silently lost rather than rejected.
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
