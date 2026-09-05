import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedReporterConfig } from '../../src/config/resolve-config.js';
import { AttachmentBudget } from '../../src/reporter/attachment-reader.js';
import { buildCase, replayMetadata } from '../../src/reporter/case-builder.js';
import type { JestAssertionResult } from '../../src/reporter/reporter.js';
import type { RuntimeMessage } from '../../src/runtime/message-types.js';

/**
 * `buildCase`/`replayMetadata` is the largest module in the package and was
 * shipped untested — which is how three dropped guards went unnoticed. These
 * mirror the sibling's coverage against Jest's `AssertionResult` shape.
 */

let outputDir: string;

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-jest-cb-'));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

function config(over: Partial<ResolvedReporterConfig> = {}): ResolvedReporterConfig {
  return {
    maxAttachmentBytes: 1_000_000,
    maxTotalAttachmentBytes: 5_000_000,
    outputDir,
    ...over,
  } as ResolvedReporterConfig;
}

function assertion(over: Partial<JestAssertionResult> = {}): JestAssertionResult {
  return {
    ancestorTitles: ['suite'],
    fullName: 'suite does a thing',
    title: 'does a thing',
    status: 'passed',
    duration: 12,
    failureMessages: [],
    ...over,
  };
}

const build = (a: JestAssertionResult, messages: RuntimeMessage[] = [], file = 'tests/a.test.ts') =>
  buildCase(a, file, messages, [], config(), new AttachmentBudget(5_000_000))!;

describe('buildCase — status and identity', () => {
  it('maps every member of Jest status onto the wire vocabulary', () => {
    const status = (s: string) => build(assertion({ status: s })).status;
    expect(status('passed')).toBe('passed');
    expect(status('failed')).toBe('failed');
    expect(status('pending')).toBe('skipped');
    expect(status('skipped')).toBe('skipped');
    expect(status('todo')).toBe('skipped');
    expect(status('disabled')).toBe('skipped');
    // The member most easily missed. Falling through to `failed` would report a
    // focused test as a FAILURE -- a false red.
    expect(status('focused')).toBe('passed');
  });

  it('gives cases from different files different ids, even with the same name', () => {
    // Jest has no per-test id of its own, and `fullName` alone is the describe
    // path plus the title -- so without the file this collides.
    const a = build(assertion(), [], 'tests/auth.test.ts');
    const b = build(assertion(), [], 'tests/billing.test.ts');
    expect(a.id).not.toBe(b.id);
    expect(a.id).toContain('tests/auth.test.ts');
  });

  it('records duration in NANOSECONDS, not milliseconds', () => {
    // Milliseconds would be ~1e6 smaller; this catches a unit regression.
    expect(build(assertion({ duration: 12 })).duration).toBe(12_000_000);
  });

  it('renders every failure message, not just the first', () => {
    const built = build(assertion({ status: 'failed', failureMessages: ['first', 'second'] }));
    expect(built.error).toContain('first');
    expect(built.error).toContain('second');
  });
});

describe('replayMetadata — the channel messages become structured metadata', () => {
  const replay = (messages: RuntimeMessage[]) =>
    replayMetadata(messages, config(), new AttachmentBudget(5_000_000));

  it('collects labels, links, tags, description and priority', () => {
    const meta = replay([
      { type: 'label', name: 'team', value: 'platform' },
      { type: 'link', url: 'https://example.com/1', linkType: 'issue', name: 'QF-1' },
      { type: 'tag', tags: ['smoke', 'smoke'] },
      { type: 'description', text: 'why' },
      { type: 'priority', value: 'high' },
    ]);
    expect(meta.labels).toEqual([{ name: 'team', value: 'platform' }]);
    expect(meta.links[0]).toEqual({ url: 'https://example.com/1', type: 'issue', name: 'QF-1' });
    expect(meta.description).toBe('why');
    expect(meta.priority).toBe('high');
  });

  it('defaults a link with no type to custom, which the wire requires', () => {
    expect(replay([{ type: 'link', url: 'https://example.com' }]).links[0]!.type).toBe('custom');
  });

  it('rebuilds step nesting from the flat pair stream', () => {
    const meta = replay([
      { type: 'step_start', name: 'outer', timestamp: 1000 },
      { type: 'step_start', name: 'inner', timestamp: 1100 },
      { type: 'step_stop', status: 'passed', timestamp: 1150 },
      { type: 'step_stop', status: 'passed', timestamp: 1300 },
    ]);
    expect(meta.steps.map((s) => s.name)).toEqual(['outer', 'inner']);
    expect(meta.steps[0]!.parentIndex).toBeUndefined();
    expect(meta.steps[1]!.parentIndex).toBe(0);
    // Real elapsed time, not zero: step_stop carries the closing timestamp.
    expect(meta.steps[1]!.duration).toBe(50_000_000);
    expect(meta.steps[0]!.duration).toBe(300_000_000);
  });

  it('marks a failed step and keeps its error', () => {
    const meta = replay([
      { type: 'step_start', name: 'boom', timestamp: 0 },
      { type: 'step_stop', status: 'failed', error: 'it broke', timestamp: 5 },
    ]);
    expect(meta.steps[0]!.status).toBe('failed');
    expect(meta.steps[0]!.error).toBe('it broke');
  });

  it('attaches a parameter to the open step, or to the case when there is none', () => {
    const meta = replay([
      { type: 'parameter', name: 'caseLevel', value: '1' },
      { type: 'step_start', name: 'outer', timestamp: 0 },
      { type: 'parameter', name: 'stepLevel', value: '2' },
      { type: 'step_stop', status: 'passed', timestamp: 1 },
    ]);
    expect(meta.caseParameters.map((p) => p.name)).toEqual(['caseLevel']);
    expect(meta.steps[0]!.parameters?.map((p) => p.name)).toEqual(['stepLevel']);
  });

  it('survives a step_stop with no open step', () => {
    // A step whose body threw past its own stop leaves the stream unbalanced.
    expect(() => replay([{ type: 'step_stop', status: 'failed', timestamp: 0 }])).not.toThrow();
  });
});

describe('buildCase — caps and properties', () => {
  it('caps attachments at the server limit', () => {
    const messages: RuntimeMessage[] = Array.from({ length: 60 }, (_, i) => ({
      type: 'attachment',
      name: `a-${i}`,
      contentBase64: Buffer.from('x').toString('base64'),
      mimeType: 'text/plain',
    }));
    // AttachmentBudget bounds the BYTES; nothing bounded the item COUNT until
    // this cap, and the server truncates or rejects past 50.
    expect(build(assertion(), messages).attachments!.length).toBeLessThanOrEqual(50);
  });

  it('records a masked parameter without its value', () => {
    const built = build(assertion(), [{ type: 'parameter', name: 'apiKey', masked: true }]);
    expect(JSON.stringify(built)).not.toContain('secret');
    expect(built.properties!['apiKey']).toBeTruthy();
  });

  it('puts the file in properties', () => {
    expect(build(assertion(), [], 'tests/x.test.ts').properties!['file']).toBe('tests/x.test.ts');
  });
});
