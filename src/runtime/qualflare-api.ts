import { buildParameter } from '../shared/parameters.js';
import { logger } from '../shared/logger.js';
import type { CasePriority, LinkType } from '../shared/types.js';
import { emit, openSegment } from './channel.js';

/**
 * Registers a root `beforeEach` that opens a channel segment per execution.
 *
 * Runs once, at module evaluation. Imports are hoisted, so this lands in the
 * root describe before any `describe` body runs and therefore before any test.
 *
 * It exists for retries. Without a per-execution boundary every attempt of a
 * retried test would append to the same stream and merge — labels counted
 * twice, and no way to tell which attempt an attachment came from. With it, the
 * reporter takes the LAST segment, matching the final-attempt-wins rule the
 * sibling reporters already document.
 *
 * Feature-detected rather than assumed: `injectGlobals: false` removes the
 * globals entirely, and this module is also loaded by the reporter in the main
 * process where they never existed. Degrading is fine — `channel.ts` opens a
 * segment lazily when it sees a message for a test it has not seen yet.
 */
function registerBoundaryHook(): void {
  try {
    const globalBeforeEach = (globalThis as { beforeEach?: (fn: () => void) => void }).beforeEach;
    if (typeof globalBeforeEach !== 'function') {
      return;
    }
    globalBeforeEach(() => {
      openSegment();
    });
  } catch {
    // Not in a test realm, or globals are unavailable. The lazy path covers it.
  }
}

registerBoundaryHook();

/**
 * The author-facing metadata API.
 *
 * Every call is fire-and-forget and fail-open: a metadata problem must never
 * fail somebody's test run, so nothing here throws and nothing returns a
 * promise that could reject unhandled.
 */
export const qualflare = {
  /** Allure-style name/value metadata (epic, feature, story, owner, ...). */
  label(name: string, value: string): void {
    emit({ type: 'label', name, value });
  },

  /** An external link. `type` is one of issue/tms/custom; unknown values are
   * rejected server-side rather than rewritten, so it is passed through. */
  link(url: string, opts?: { type?: LinkType; name?: string }): void {
    emit({
      type: 'link',
      url,
      ...(opts?.type ? { linkType: opts.type } : {}),
      ...(opts?.name ? { name: opts.name } : {}),
    });
  },

  tag(...tags: string[]): void {
    if (tags.length > 0) {
      emit({ type: 'tag', tags });
    }
  },

  description(text: string): void {
    emit({ type: 'description', text });
  },

  priority(value: CasePriority): void {
    emit({ type: 'priority', value });
  },

  /**
   * A case- or step-level parameter.
   *
   * MASKING HAPPENS HERE, in the worker, before anything is serialized. The
   * sibling reporters can afford to mask in the reporter because their channel
   * is memory; this one is a FILE. `buildParameter` drops the value entirely
   * when masked, so the secret never reaches the temp directory, the report, or
   * the server.
   */
  parameter(name: string, value?: string, opts?: { masked?: boolean }): void {
    const param = buildParameter(name, value, opts?.masked);
    emit({
      type: 'parameter',
      name: param.name,
      ...(param.value !== undefined ? { value: param.value } : {}),
      ...(param.masked ? { masked: true } : {}),
    });
  },

  /** Attaches in-memory content. Images are written into the report's output
   * directory by the REPORTER, which is the process that owns it. */
  attachment(name: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; mimeType?: string }): void {
    const contentBase64 =
      opts?.encoding === 'base64' ? content : Buffer.from(content, 'utf8').toString('base64');
    emit({
      type: 'attachment',
      name,
      contentBase64,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    });
  },

  /** Attaches a file by path. Only the path travels; the reporter reads it. */
  attachmentFromFile(name: string, path: string, opts?: { mimeType?: string }): void {
    emit({
      type: 'attachment_from_file',
      name,
      path,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    });
  },

  /**
   * Records a named step around `fn`, returning whatever `fn` returns.
   *
   * The user's error is always rethrown untouched — the step is recorded as
   * failed on the way past. Only the bookkeeping is wrapped, never `fn` itself,
   * so this can never swallow or alter a test's own failure.
   */
  async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      emit({ type: 'step_start', name, timestamp: startedAt });
    } catch {
      // Bookkeeping only; never let it touch the body below.
    }

    try {
      const result = await fn();
      closeStep('passed');
      return result;
    } catch (err) {
      closeStep('failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
};

function closeStep(status: 'passed' | 'failed', error?: string): void {
  try {
    emit({ type: 'step_stop', status, ...(error ? { error } : {}), timestamp: Date.now() });
  } catch {
    logger.warn('could not record the end of a qualflare.step()');
  }
}
