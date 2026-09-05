import type { NanosecondDuration } from './types.js';

const NS_PER_MS = 1_000_000;

/**
 * Converts a plain millisecond duration (e.g. from `Date.now()` deltas used
 * by manual `qualflare.step()` timing) into the wire format's raw-nanosecond
 * integer (see `NanosecondDuration` in ./types.ts).
 *
 * Rounds (not truncates) so fractional-ms input doesn't lose precision by
 * always rounding toward zero. Negative input is clamped to 0 — a negative
 * duration is never legitimate and silently clamping is safer for an
 * ingest payload than throwing and aborting an otherwise-good report.
 */
export function msToNs(ms: number): NanosecondDuration {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return Math.round(ms * NS_PER_MS);
}
