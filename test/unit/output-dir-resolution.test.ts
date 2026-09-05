import * as path from 'node:path';

import * as fs from 'node:fs';
import * as os from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import QualflareReporter from '../../src/reporter/reporter.js';

// Constructing a reporter creates its channel directory as a side effect --
// necessarily, since it must exist before Jest forks any worker. These tests
// construct several, so they clean up after themselves rather than littering
// the temp directory.
const CHANNEL_PREFIX = 'qualflare-jest-';
afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(CHANNEL_PREFIX)) {
      fs.rmSync(`${os.tmpdir()}/${entry}`, { recursive: true, force: true });
    }
  }
});

/**
 * A relative `outputDir` resolves against Jest's `rootDir`, not the shell's
 * cwd — and it must resolve to the SAME place for the report and for every
 * artifact beside it.
 *
 * This is a regression test written before the bug could happen here. The same
 * defect was found in TWO sibling reporters during the dogfood work:
 * `resolveOutputDir` was applied only where the JSON was written, while the
 * image writer took the raw config string. The report landed inside the repo
 * and every screenshot one directory above it, leaving `localImagePath`
 * pointing at a file the CLI could not find. Nothing failed; the report just
 * referenced absent files.
 *
 * Resolve once, centrally, and assert it.
 */
describe('outputDir resolution', () => {
  const outputDirOf = (reporter: QualflareReporter): string =>
    (reporter as never as { config: { outputDir: string } }).config.outputDir;

  it('resolves a relative outputDir against rootDir, not the cwd', () => {
    const reporter = new QualflareReporter({ rootDir: '/repo/packages/app' }, { outputDir: '../results' });
    expect(outputDirOf(reporter)).toBe(path.resolve('/repo/packages/app', '../results'));
  });

  it('leaves an absolute outputDir alone', () => {
    const reporter = new QualflareReporter({ rootDir: '/repo' }, { outputDir: '/tmp/somewhere' });
    expect(outputDirOf(reporter)).toBe('/tmp/somewhere');
  });

  it('resolves once, so a second pass is a no-op', () => {
    // The bug was two resolutions disagreeing. Whatever else changes, resolving
    // an already-resolved value must not move it.
    const reporter = new QualflareReporter({ rootDir: '/repo' }, { outputDir: './out' });
    const once = outputDirOf(reporter);
    expect(path.isAbsolute(once)).toBe(true);
    expect(path.resolve(once)).toBe(once);
  });

  it('falls back to the cwd when Jest supplies no rootDir', () => {
    const reporter = new QualflareReporter(undefined, { outputDir: './out' });
    expect(outputDirOf(reporter)).toBe(path.resolve(process.cwd(), './out'));
  });
});
