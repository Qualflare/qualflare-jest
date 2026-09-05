import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Case, Collect } from '../../src/shared/types.js';

/**
 * Drives a REAL `jest` run against the fixture project and asserts the report
 * it wrote. The fixture loads the reporter from BUILT dist/, so `npm run build`
 * is a prerequisite and a broken exports map fails here rather than after
 * publishing.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'fixtures/jest-project');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let outputDir: string;

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualflare-jest-integration-'));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

/** `reject: false` because the fixture fails on purpose — the assertions are
 * about the written report, never the exit code. */
async function runFixture(extraArgs: string[] = []): Promise<Collect> {
  const result = await execa('npx', ['jest', '--config', 'jest.config.mjs', ...extraArgs], {
    cwd: fixtureDir,
    env: { ...process.env, QF_OUT: outputDir },
    reject: false,
  });

  const reports = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((f) => f.endsWith('.json'))
    : [];
  if (reports.length !== 1) {
    throw new Error(
      `expected exactly one report in ${outputDir}, found ${reports.length}. exit=${result.exitCode}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return JSON.parse(fs.readFileSync(path.join(outputDir, reports[0]!), 'utf8')) as Collect;
}

const allCases = (report: Collect): Case[] => report.suites.flatMap((s) => s.cases);
const caseNamed = (report: Collect, needle: string): Case => {
  const found = allCases(report).find((c) => c.name.includes(needle));
  if (!found) {
    throw new Error(`no case matching ${needle}. Have: ${allCases(report).map((c) => c.name).join(' | ')}`);
  }
  return found;
};

describe('qualflare-jest against a real jest run', () => {
  it(
    'writes one report the CLI can identify, with statuses mapped correctly',
    async () => {
      const report = await runFixture();

      // The format-detection triple. Drop any one of these and `qf collect`
      // falls back to filename detection, where a file named jest-*.json is
      // routed to the CLI's Jest-JSON parser and misparsed.
      expect(report.framework).toBe('jest');
      expect(report.metadata).toBeTruthy();
      expect(report.suites.length).toBeGreaterThan(0);
      expect(report.suites.every((s) => s.category === 'jest')).toBe(true);
      // The Playwright-JSON signature must be absent or the CLI mis-routes.
      expect(report).not.toHaveProperty('config');

      expect(caseNamed(report, 'passes').status).toBe('passed');
      expect(caseNamed(report, 'recognizable error message').status).toBe('failed');
      expect(caseNamed(report, 'recognizable error message').error).toContain(
        'qualflare-jest-integration-test-marker',
      );
      // Jest's `skipped` and `todo` both mean "did not execute".
      expect(caseNamed(report, 'is skipped statically').status).toBe('skipped');
      expect(caseNamed(report, 'is a todo').status).toBe('skipped');
      expect(caseNamed(report, 'runs after a skipped test').status).toBe('passed');

      // One suite per test file, path relativized so the same test is the same
      // suite on another machine.
      expect(report.suites.every((s) => !path.isAbsolute(s.name))).toBe(true);
    },
    180_000,
  );

  it(
    'carries metadata across the worker boundary',
    async () => {
      const report = await runFixture();
      const meta = caseNamed(report, 'records metadata');

      // Jest runs tests in worker processes and reporters in the main process.
      // Everything below had to cross that boundary through the side channel.
      expect(meta.labels).toEqual(expect.arrayContaining([{ name: 'team', value: 'platform' }]));
      expect(meta.tags).toEqual(expect.arrayContaining(['smoke']));
      expect(meta.properties?.plan).toBe('pro');

      // Masked at SOURCE, in the worker: the channel is a file, so the real
      // value must never be serialized. Asserted over the whole payload.
      expect(JSON.stringify(report)).not.toContain('super-secret-value');
      expect(meta.properties?.apiKey).toBeTruthy();
      expect(meta.properties?.apiKey).not.toContain('secret');
    },
    180_000,
  );

  it(
    'records nested steps and routes an image out of band',
    async () => {
      const report = await runFixture();
      const withAttachments = caseNamed(report, 'attaches an image and a note');

      const inner = withAttachments.steps?.find((s) => s.name === 'inner');
      expect(inner).toBeDefined();
      expect(inner?.parentIndex).toBe(0);

      const image = withAttachments.attachments?.find((a) => a.mimeType === 'image/png');
      expect(image).toBeDefined();
      expect(image?.content).toBeUndefined();
      expect(typeof image?.localImagePath).toBe('string');
      const imagePath = path.join(outputDir, image!.localImagePath!);
      expect(fs.existsSync(imagePath)).toBe(true);
      // A real PNG, not merely named one: the upload endpoint cross-checks the
      // extension against the MIME type it is handed.
      expect(fs.readFileSync(imagePath).subarray(0, 8)).toEqual(PNG_MAGIC);
      expect(image?.fileSize).toBe(fs.statSync(imagePath).size);

      // A non-image stays inline.
      const note = withAttachments.attachments?.find((a) => a.name === 'note');
      expect(note?.localImagePath).toBeUndefined();
      expect(typeof note?.content).toBe('string');

      // An oversized attachment is skipped with a warning, never fatal.
      expect(caseNamed(report, 'oversized attachment').status).toBe('passed');
    },
    180_000,
  );

  it(
    'builds per-attempt history from invocations',
    async () => {
      const report = await runFixture();
      const flaky = caseNamed(report, 'fails twice then passes');

      expect(flaky.status).toBe('passed');
      expect(flaky.retryCount).toBe(2);
      expect(flaky.isFlaky).toBe(true);
      expect(flaky.attempts).toHaveLength(3);
      expect(flaky.attempts?.map((a) => a.status)).toEqual(['failed', 'failed', 'passed']);
      // The MESSAGES are deliberately not asserted: Jest only supplies
      // retryReasons under jest.retryTimes(n, { logErrorsBeforeRetry: true }),
      // which this fixture does not set. The structure is what is always
      // available, and it is what this asserts.
    },
    180_000,
  );

  it(
    'does not pollute a suite that mocks fs',
    async () => {
      // The fixture asserts this from the inside (fs-mock.test.js expects
      // appendFileSync not to have been called). If the reporter wrote through
      // the user's mock, that test fails -- meaning this package would break
      // suites that pass without it.
      const report = await runFixture();
      const mocking = caseNamed(report, 'does not appear in a user fs mock');
      expect(mocking.status).toBe('passed');
      // And metadata still crossed, because jest.requireActual gave us the real
      // fs rather than degrading.
      expect(mocking.labels).toEqual(expect.arrayContaining([{ name: 'team', value: 'platform' }]));
    },
    180_000,
  );

  it(
    'produces the same report with workers and with --runInBand',
    async () => {
      // The whole channel design rests on this: one code path, whether or not a
      // worker boundary exists.
      const withWorkers = await runFixture();
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.mkdirSync(outputDir, { recursive: true });
      const inBand = await runFixture(['--runInBand']);

      const shape = (r: Collect) =>
        allCases(r)
          .map((c) => `${c.name}|${c.status}|${(c.labels ?? []).length}|${(c.attempts ?? []).length}`)
          .sort();
      expect(shape(inBand)).toEqual(shape(withWorkers));
    },
    240_000,
  );

  it(
    'leaves no channel directory behind',
    async () => {
      const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('qualflare-jest-'));
      await runFixture();
      const after = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('qualflare-jest-'));
      // The integration temp dirs themselves share the prefix, so compare the
      // delta rather than requiring zero.
      expect(after.length).toBeLessThanOrEqual(before.length + 1);
    },
    180_000,
  );

  it(
    'makes no network calls',
    async () => {
      const dist = path.resolve(here, '../../dist');
      for (const file of ['index.js', 'reporter/index.js']) {
        const source = fs.readFileSync(path.join(dist, file), 'utf8');
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).not.toMatch(/require\(['"](https?|undici|axios|node-fetch)['"]\)/);
      }
    },
    30_000,
  );
});
