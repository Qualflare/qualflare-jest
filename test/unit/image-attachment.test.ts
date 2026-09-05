import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  copyImageAttachment,
  isOffloadableImage,
  writeImageAttachment,
} from '../../src/reporter/image-writer.js';

let dir: string;
let out: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-vitest-image-'));
  out = path.join(dir, 'results');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFile(name: string, bytes: Buffer = PNG): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

describe('copyImageAttachment', () => {
  it('copies a screenshot into outputDir under a unique relative name', () => {
    const r = copyImageAttachment(makeFile('shot.png'), out, 1_000_000)!;
    expect(r.mimeType).toBe('image/png');
    expect(r.localImagePath).toMatch(/\.png$/);
    // Relative, never absolute — the directory travels as one artifact bundle.
    expect(path.isAbsolute(r.localImagePath)).toBe(false);
    expect(fs.readFileSync(path.join(out, r.localImagePath)).equals(PNG)).toBe(true);
    expect(r.fileSize).toBe(PNG.length);
  });

  it('derives the MIME type from the extension, not a declared type', () => {
    // The upload endpoint cross-checks extension against MIME, so a disagreement
    // would cost a 400 per screenshot.
    expect(copyImageAttachment(makeFile('a.jpg'), out, 1_000_000)!.mimeType).toBe('image/jpeg');
    expect(copyImageAttachment(makeFile('b.jpeg'), out, 1_000_000)!.mimeType).toBe('image/jpeg');
    expect(copyImageAttachment(makeFile('c.gif'), out, 1_000_000)!.mimeType).toBe('image/gif');
  });

  it('declines formats the endpoint does not accept, leaving them to the inline path', () => {
    for (const n of ['d.bmp', 'e.svg', 'f.txt', 'g.json']) {
      expect(copyImageAttachment(makeFile(n), out, 1_000_000)).toBeUndefined();
    }
  });

  it('skips an oversized image without copying it first', () => {
    expect(copyImageAttachment(makeFile('big.png', Buffer.alloc(4096)), out, 1024)).toBeUndefined();
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toHaveLength(0);
  });

  it('returns undefined rather than throwing without an outputDir', () => {
    // A reporter must never throw over an attachment; without the guard this is
    // a TypeError out of path.join.
    expect(() => copyImageAttachment(makeFile('shot.png'), undefined as never, 1_000_000)).not.toThrow();
    expect(copyImageAttachment(makeFile('shot.png'), undefined as never, 1_000_000)).toBeUndefined();
  });

  it('skips an unreadable file instead of throwing', () => {
    expect(copyImageAttachment(path.join(dir, 'nope.png'), out, 1_000_000)).toBeUndefined();
  });
});

describe('writeImageAttachment', () => {
  it('writes an in-memory screenshot out, the shape both image sources produce', () => {
    const r = writeImageAttachment(PNG, 'image/png', out, 1_000_000)!;
    expect(r.localImagePath).toMatch(/\.png$/);
    expect(fs.readFileSync(path.join(out, r.localImagePath)).equals(PNG)).toBe(true);
    expect(r.fileSize).toBe(PNG.length);
  });

  it('picks the extension from the MIME type, since a buffer has no filename', () => {
    expect(writeImageAttachment(PNG, 'image/jpeg', out, 1_000_000)!.localImagePath).toMatch(/\.jpg$/);
    expect(writeImageAttachment(PNG, 'image/gif', out, 1_000_000)!.localImagePath).toMatch(/\.gif$/);
  });

  it('declines a MIME type with no accepted extension', () => {
    expect(writeImageAttachment(PNG, 'image/bmp', out, 1_000_000)).toBeUndefined();
    expect(writeImageAttachment(PNG, 'text/plain', out, 1_000_000)).toBeUndefined();
  });

  it('respects the cap, and never throws without an outputDir', () => {
    expect(writeImageAttachment(Buffer.alloc(4096), 'image/png', out, 1024)).toBeUndefined();
    expect(() => writeImageAttachment(PNG, 'image/png', undefined as never, 1_000_000)).not.toThrow();
  });

  it('gives each screenshot its own filename', () => {
    const a = writeImageAttachment(PNG, 'image/png', out, 1_000_000)!;
    const b = writeImageAttachment(PNG, 'image/png', out, 1_000_000)!;
    expect(a.localImagePath).not.toBe(b.localImagePath);
    expect(fs.readdirSync(out)).toHaveLength(2);
  });
});

describe('isOffloadableImage', () => {
  it('accepts exactly the three types the upload endpoint allows', () => {
    expect(isOffloadableImage('image/png')).toBe(true);
    expect(isOffloadableImage('image/jpeg')).toBe(true);
    expect(isOffloadableImage('image/gif')).toBe(true);
    expect(isOffloadableImage('image/bmp')).toBe(false);
    expect(isOffloadableImage('text/plain')).toBe(false);
    expect(isOffloadableImage(undefined)).toBe(false);
  });
});
