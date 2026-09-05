import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_ENV_VAR,
  collapseByCase,
  drain,
  emit,
  openSegment,
  segmentKey,
} from '../../src/runtime/channel.js';

/**
 * The metadata side-channel is the one genuinely new mechanism in this package:
 * Jest runs tests in worker processes and reporters in the main process, with
 * no built-in per-test channel between them.
 *
 * These tests drive it directly rather than through a real Jest run, by
 * stubbing the `expect.getState()` global the worker side reads. The real
 * worker boundary is covered by the integration suite; what is covered here is
 * the behaviour that is hard to observe from outside — what lands on disk, what
 * happens without a channel, and how retried attempts are separated.
 */

let dir: string;
const REAL_SECRET = 'super-secret-value';

/** Impersonates Jest's in-test `expect.getState()`. */
function inTest(fullName: string | undefined, testPath = '/repo/a.test.ts'): void {
  (globalThis as { expect?: unknown }).expect = {
    getState: () => (fullName === undefined ? {} : { currentTestName: fullName, testPath }),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-jest-channel-'));
  process.env[CHANNEL_ENV_VAR] = dir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env[CHANNEL_ENV_VAR];
  delete (globalThis as { expect?: unknown }).expect;
});

/** The channel resolves its file once per module load, so each test that needs
 * a fresh write target re-imports the module. */
async function freshChannel(): Promise<typeof import('../../src/runtime/channel.js')> {
  vi.resetModules();
  return import('../../src/runtime/channel.js');
}

describe('the channel writes what the reporter can read back', () => {
  it('round-trips a message from the worker side to the reporter side', async () => {
    const channel = await freshChannel();
    inTest('suite > does a thing');
    channel.openSegment();
    channel.emit({ type: 'label', name: 'team', value: 'platform' });

    const segments = channel.drain(dir);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.fullName).toBe('suite > does a thing');
    expect(segments[0]!.messages).toEqual([{ type: 'label', name: 'team', value: 'platform' }]);
  });

  it('keys on the pair that Jest actually reports back', async () => {
    const channel = await freshChannel();
    inTest('suite > one', '/repo/a.test.ts');
    channel.openSegment();
    channel.emit({ type: 'tag', tags: ['x'] });

    const byCase = channel.collapseByCase(channel.drain(dir));
    // `currentTestName` is the describe titles plus the title joined by spaces,
    // which is exactly `TestCaseResult.fullName`; `testPath` matches `test.path`.
    expect([...byCase.keys()]).toEqual([segmentKey('/repo/a.test.ts', 'suite > one')]);
  });

  it('separates the attempts of a retried test rather than merging them', async () => {
    const channel = await freshChannel();
    inTest('flaky');
    // Two executions of the same test. Without a per-execution boundary these
    // would merge and every label would be counted twice.
    channel.openSegment();
    channel.emit({ type: 'label', name: 'attempt', value: 'first' });
    channel.openSegment();
    channel.emit({ type: 'label', name: 'attempt', value: 'second' });

    const segments = channel.drain(dir);
    expect(segments).toHaveLength(2);

    // Final attempt wins, matching the rule the sibling reporters document.
    const byCase = channel.collapseByCase(segments);
    expect(byCase.get(segmentKey('/repo/a.test.ts', 'flaky'))).toEqual([
      { type: 'label', name: 'attempt', value: 'second' },
    ]);
  });
});

describe('the channel never leaks a masked value to disk', () => {
  it('writes no trace of a masked parameter into the channel file', async () => {
    const channel = await freshChannel();
    inTest('secrets');
    channel.openSegment();
    // This is what qualflare.parameter(..., { masked: true }) produces: the
    // value is dropped in the WORKER, before serialization. The sibling
    // reporters can mask in the reporter because their channel is memory; this
    // one is a file, so masking has to happen before the write.
    channel.emit({ type: 'parameter', name: 'apiKey', masked: true });

    const written = fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('');
    expect(written).not.toContain(REAL_SECRET);
    expect(written).toContain('apiKey');
    expect(written).toContain('"masked":true');
  });
});

describe('the channel fails open', () => {
  it('drops a message emitted outside a running test instead of guessing', async () => {
    const channel = await freshChannel();
    // beforeAll / module scope: expect.getState() has no currentTestName, so
    // there is no case to attribute to. Attaching it to whichever test reports
    // first is a misattribution bug the Cypress plugin already had to fix.
    inTest(undefined);
    expect(() => channel.emit({ type: 'tag', tags: ['orphan'] })).not.toThrow();
    expect(channel.drain(dir)).toHaveLength(0);
  });

  it('does nothing when no channel was handed over', async () => {
    delete process.env[CHANNEL_ENV_VAR];
    const channel = await freshChannel();
    inTest('no channel');
    expect(() => channel.emit({ type: 'tag', tags: ['x'] })).not.toThrow();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('survives a directory that has already been cleaned up', async () => {
    const channel = await freshChannel();
    inTest('late worker');
    fs.rmSync(dir, { recursive: true, force: true });
    // A late worker must never re-create the directory: that would resurrect a
    // finished session and leave files behind after the run.
    expect(() => channel.emit({ type: 'tag', tags: ['late'] })).not.toThrow();
    expect(fs.existsSync(dir)).toBe(false);
    fs.mkdirSync(dir, { recursive: true });
  });

  it('reads every message that landed before a worker died mid-write', async () => {
    fs.writeFileSync(
      path.join(dir, 'worker.ndjson'),
      `${JSON.stringify({ k: 'open', testPath: '/repo/a.test.ts', fullName: 't' })}\n` +
        `${JSON.stringify({ k: 'msg', testPath: '/repo/a.test.ts', fullName: 't', message: { type: 'tag', tags: ['kept'] } })}\n` +
        '{"k":"msg","testPath":"/repo/a.test.ts","fullNam',
    );
    const segments = drain(dir);
    expect(segments).toHaveLength(1);
    // The torn final line is skipped; one bad line is not a lost file.
    expect(segments[0]!.messages).toEqual([{ type: 'tag', tags: ['kept'] }]);
  });

  it('returns nothing rather than throwing when the directory does not exist', () => {
    expect(drain(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('exports used by the reporter', () => {
  it('emit and openSegment are safe to call with no test context at all', () => {
    delete (globalThis as { expect?: unknown }).expect;
    expect(() => openSegment()).not.toThrow();
    expect(() => emit({ type: 'tag', tags: ['x'] })).not.toThrow();
  });

  it('collapseByCase keeps one entry per case', () => {
    const collapsed = collapseByCase([
      { testPath: '/a', fullName: 'x', messages: [{ type: 'tag', tags: ['1'] }] },
      { testPath: '/a', fullName: 'x', messages: [{ type: 'tag', tags: ['2'] }] },
      { testPath: '/a', fullName: 'y', messages: [] },
    ]);
    expect(collapsed.size).toBe(2);
    expect(collapsed.get(segmentKey('/a', 'x'))).toEqual([{ type: 'tag', tags: ['2'] }]);
  });
});
