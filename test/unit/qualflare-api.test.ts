import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL_ENV_VAR, drain } from '../../src/runtime/channel.js';

/**
 * The author-facing API — the surface users actually call, and previously the
 * only public module in the package with no test at all.
 *
 * Driven through the real channel rather than a stub, so what is asserted is
 * what would land on disk in a worker.
 */

let dir: string;

function inTest(fullName = 'suite > a test'): void {
  (globalThis as { expect?: unknown }).expect = {
    getState: () => ({ currentTestName: fullName, testPath: '/repo/a.test.ts' }),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-jest-api-'));
  process.env[CHANNEL_ENV_VAR] = dir;
  inTest();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env[CHANNEL_ENV_VAR];
  delete (globalThis as { expect?: unknown }).expect;
});

async function freshApi(): Promise<typeof import('../../src/runtime/qualflare-api.js')> {
  vi.resetModules();
  return import('../../src/runtime/qualflare-api.js');
}

const messages = () => drain(dir).flatMap((s) => s.messages);

describe('qualflare.*', () => {
  it('records each metadata call in order', async () => {
    const { qualflare } = await freshApi();
    qualflare.label('team', 'platform');
    qualflare.tag('smoke', 'slow');
    qualflare.description('why');
    qualflare.priority('high');

    expect(messages().map((m) => m.type)).toEqual(['label', 'tag', 'description', 'priority']);
  });

  it('defaults a link with no type, and passes an explicit one through', async () => {
    const { qualflare } = await freshApi();
    qualflare.link('https://example.com/a');
    qualflare.link('https://example.com/b', { type: 'issue', name: 'QF-1' });
    const links = messages().filter((m) => m.type === 'link');
    expect(links[0]).not.toHaveProperty('linkType');
    expect(links[1]).toMatchObject({ linkType: 'issue', name: 'QF-1' });
  });

  it('base64-encodes utf8 attachment content by default and passes base64 through', async () => {
    const { qualflare } = await freshApi();
    qualflare.attachment('a', 'hello');
    qualflare.attachment('b', Buffer.from('hello').toString('base64'), { encoding: 'base64' });
    const [a, b] = messages().filter((m) => m.type === 'attachment') as Array<{ contentBase64: string }>;
    expect(a!.contentBase64).toBe(Buffer.from('hello').toString('base64'));
    expect(b!.contentBase64).toBe(a!.contentBase64);
  });

  it('drops a masked value before it is ever serialized', async () => {
    // The channel is a FILE, so masking after the fact would already have
    // written the secret. This asserts the bytes on disk, not the object.
    const { qualflare } = await freshApi();
    qualflare.parameter('apiKey', 'super-secret-value', { masked: true });
    const onDisk = fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('');
    expect(onDisk).not.toContain('super-secret-value');
    expect(onDisk).toContain('"masked":true');
  });

  it('brackets step() with start and stop, and returns the body value', async () => {
    const { qualflare } = await freshApi();
    const result = await qualflare.step('outer', () => 42);
    expect(result).toBe(42);
    expect(messages().map((m) => m.type)).toEqual(['step_start', 'step_stop']);
  });

  it('marks a throwing step failed AND rethrows, so the test still fails', async () => {
    // The property that stops this package swallowing a user's failure.
    const { qualflare } = await freshApi();
    await expect(
      qualflare.step('boom', () => {
        throw new Error('user error');
      }),
    ).rejects.toThrow('user error');

    const stop = messages().find((m) => m.type === 'step_stop') as { status: string; error?: string };
    expect(stop.status).toBe('failed');
    expect(stop.error).toContain('user error');
  });

  it('nests steps in arrival order', async () => {
    const { qualflare } = await freshApi();
    await qualflare.step('outer', async () => {
      await qualflare.step('inner', () => undefined);
    });
    expect(messages().map((m) => m.type)).toEqual([
      'step_start',
      'step_start',
      'step_stop',
      'step_stop',
    ]);
  });

  it('never throws when there is no channel at all', async () => {
    delete process.env[CHANNEL_ENV_VAR];
    const { qualflare } = await freshApi();
    expect(() => qualflare.label('a', 'b')).not.toThrow();
    await expect(qualflare.step('s', () => 'ok')).resolves.toBe('ok');
  });
});
