import { describe, expect, it } from 'vitest';

import { buildAttempts } from '../../src/reporter/case-builder.js';
import type { JestAssertionResult } from '../../src/reporter/reporter.js';

/**
 * Per-attempt retry history, built from what Jest reports directly.
 *
 * The numbers below were measured against a real Jest 30.5.1 run, not taken
 * from the type definitions — which matters, because the types promise more
 * than Jest delivers by default:
 *
 *   jest.retryTimes(2)                                  invocations=3, retryReasons=[]
 *   jest.retryTimes(2, { logErrorsBeforeRetry: true })   invocations=3, retryReasons=[e1, e2]
 *
 * So the attempt STRUCTURE is always available and the per-attempt error text
 * is opt-in. Both shapes have to work.
 */

function assertion(over: Partial<JestAssertionResult> = {}): JestAssertionResult {
  return {
    ancestorTitles: [],
    fullName: 'flaky',
    title: 'flaky',
    status: 'passed',
    failureMessages: [],
    ...over,
  };
}

describe('buildAttempts', () => {
  it('records nothing for a test that ran once', () => {
    // Contract rule: fewer than two attempts persists nothing server-side, so
    // sending a single-element array is bytes against the body limit for a row
    // the server discards.
    expect(buildAttempts(assertion({ invocations: 1 }), 'passed')).toBeUndefined();
    expect(buildAttempts(assertion({}), 'passed')).toBeUndefined();
  });

  it('reconstructs a flaky run: earlier attempts failed, the final one passed', () => {
    const attempts = buildAttempts(
      assertion({ invocations: 3, retryReasons: ['Error: boom 1', 'Error: boom 2'] }),
      'passed',
    )!;
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'passed']);
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    expect(attempts[0]!.message).toBe('Error: boom 1');
    expect(attempts[1]!.message).toBe('Error: boom 2');
    // The final attempt passed, so it contributed no error.
    expect(attempts[2]!.message).toBeUndefined();
  });

  it('reconstructs a run where every attempt failed', () => {
    // The final attempt's error lives in failureMessages, not retryReasons.
    const attempts = buildAttempts(
      assertion({
        status: 'failed',
        invocations: 3,
        retryReasons: ['Error: boom 1', 'Error: boom 2'],
        failureMessages: ['Error: boom 3'],
      }),
      'failed',
    )!;
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'failed']);
    expect(attempts.map((a) => a.message)).toEqual(['Error: boom 1', 'Error: boom 2', 'Error: boom 3']);
  });

  it('still records the structure when retryReasons is empty', () => {
    // The DEFAULT shape: jest.retryTimes(n) without logErrorsBeforeRetry.
    // Knowing a test failed twice before passing is worth recording even
    // without the messages, so this must not collapse to undefined.
    const attempts = buildAttempts(assertion({ invocations: 3, retryReasons: [] }), 'passed')!;
    expect(attempts).toHaveLength(3);
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'passed']);
    expect(attempts.every((a) => a.message === undefined)).toBe(true);
  });

  it('keeps the final attempt when trimming past the server cap', () => {
    const n = 60;
    const attempts = buildAttempts(
      assertion({
        status: 'failed',
        invocations: n,
        retryReasons: Array.from({ length: n - 1 }, (_, i) => `e-${i}`),
        failureMessages: ['final'],
      }),
      'failed',
    )!;
    expect(attempts).toHaveLength(50);
    // First 49 plus the LAST one — a plain slice(0, 50) would discard the
    // attempt that carries the outcome.
    expect(attempts[48]!.message).toBe('e-48');
    expect(attempts[49]!.attempt).toBe(n);
    expect(attempts[49]!.message).toBe('final');
  });

  it('truncates an oversized attempt message to the cap the server stores', () => {
    const attempts = buildAttempts(
      assertion({ invocations: 2, retryReasons: ['x'.repeat(20_000)] }),
      'passed',
    )!;
    expect(attempts[0]!.message).toHaveLength(8192);
  });

  it('never sets a per-attempt duration, which Jest does not expose', () => {
    // Jest reports one duration for the case, not per attempt. Filling these
    // from the total would claim every attempt took the whole time.
    const attempts = buildAttempts(assertion({ invocations: 2, retryReasons: ['e'] }), 'passed')!;
    expect(attempts.every((a) => a.duration === undefined)).toBe(true);
    expect(attempts.every((a) => a.startedAt === undefined)).toBe(true);
  });
});
