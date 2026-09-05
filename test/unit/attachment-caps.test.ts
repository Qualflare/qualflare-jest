import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AttachmentBudget, inlineFromBuffer, inlineFromFile } from '../../src/reporter/attachment-reader.js';
import type { ResolvedReporterConfig } from '../../src/config/resolve-config.js';

// Only the fields these helpers read; a full ResolvedReporterConfig would add
// nothing and would break whenever an unrelated option is added.
function config(over: Partial<ResolvedReporterConfig> = {}): ResolvedReporterConfig {
  return {
    maxAttachmentBytes: 1000,
    maxTotalAttachmentBytes: 2000,
    ...over,
  } as ResolvedReporterConfig;
}

describe('AttachmentBudget', () => {
  it('reserves until exhausted, then refuses', () => {
    const budget = new AttachmentBudget(100);
    expect(budget.tryReserve(60)).toBe(true);
    expect(budget.tryReserve(50)).toBe(false); // would total 110
    expect(budget.usedBytes).toBe(60);
  });

  it('refunds a release, so a discarded attempt does not starve later tests', () => {
    const budget = new AttachmentBudget(100);
    budget.tryReserve(80);
    budget.release(80);
    expect(budget.usedBytes).toBe(0);
    expect(budget.tryReserve(80)).toBe(true);
  });

  it('never goes negative on an over-release', () => {
    const budget = new AttachmentBudget(100);
    budget.tryReserve(10);
    budget.release(999);
    expect(budget.usedBytes).toBe(0);
  });
});

describe('inlineFromBuffer', () => {
  it('inlines content as base64 with its real byte size', () => {
    const out = inlineFromBuffer('note', Buffer.from('hello'), 'text/plain', config(), new AttachmentBudget(2000));
    expect(out).toEqual({
      name: 'note',
      mimeType: 'text/plain',
      content: Buffer.from('hello').toString('base64'),
      fileSize: 5,
    });
  });

  it('skips content over maxAttachmentBytes without reserving budget', () => {
    const budget = new AttachmentBudget(10_000);
    const out = inlineFromBuffer('big', Buffer.alloc(1001), undefined, config(), budget);
    expect(out).toBeUndefined();
    expect(budget.usedBytes).toBe(0);
  });

  it('skips when the run budget is exhausted', () => {
    const budget = new AttachmentBudget(100);
    budget.tryReserve(100);
    expect(inlineFromBuffer('n', Buffer.from('x'), undefined, config(), budget)).toBeUndefined();
  });
});

describe('inlineFromFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-attach-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads and inlines a small file', () => {
    const file = path.join(dir, 'note.txt');
    fs.writeFileSync(file, 'hello');
    const out = inlineFromFile('note', file, 'text/plain', config(), new AttachmentBudget(2000));
    expect(out?.content).toBe(Buffer.from('hello').toString('base64'));
    expect(out?.fileSize).toBe(5);
  });

  it('rejects an oversized file WITHOUT reading it into memory', () => {
    // The regression this whole file exists for: `qualflare.attachmentFromFile()`
    // used to read and inline with no cap at all, so one large file produced a
    // >10MB request body, /collect returned 413, and the ENTIRE launch was
    // lost — not just the attachment.
    const file = path.join(dir, 'big.bin');
    fs.writeFileSync(file, Buffer.alloc(5000));
    const budget = new AttachmentBudget(1_000_000);
    expect(inlineFromFile('big', file, undefined, config(), budget)).toBeUndefined();
    expect(budget.usedBytes).toBe(0);
  });

  it('skips a missing file rather than throwing', () => {
    expect(inlineFromFile('gone', path.join(dir, 'nope.txt'), undefined, config(), new AttachmentBudget(2000))).toBeUndefined();
  });

  it('respects the run budget even when the file itself fits', () => {
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, Buffer.alloc(500));
    const budget = new AttachmentBudget(600);
    expect(inlineFromFile('a', file, undefined, config(), budget)).toBeDefined();
    // Second identical file fits maxAttachmentBytes but not the remaining budget.
    expect(inlineFromFile('b', file, undefined, config(), budget)).toBeUndefined();
  });
});
