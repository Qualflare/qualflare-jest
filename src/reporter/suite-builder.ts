import * as path from 'node:path';

import { MAX_CASES_PER_SUITE, MAX_SUITES_PER_LAUNCH } from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import type { Case, Suite } from '../shared/types.js';

/**
 * Makes a test-module path stable and portable: relative to the Jest
 * project root, with POSIX separators regardless of the OS that produced it.
 *
 * Without this, the same suite reported from a Windows runner and a Linux
 * runner would be two different suites server-side, and an absolute path
 * would leak a CI agent's directory layout into the report.
 */
export function relativizeFile(file: string, rootDir: string): string {
  const relative = path.isAbsolute(file) ? path.relative(rootDir, file) : file;
  return relative.split(path.sep).join('/');
}

/** One case plus the test module it came from. */
export interface CaseWithFile {
  file: string;
  browser?: string;
  testCase: Case;
}

/**
 * Groups finished cases into one Suite per test module (file).
 *
 * Grouping happens once at `onTestRunEnd` rather than incrementally: Jest
 * interleaves results across worker threads, so there is no point during the
 * run at which one module's cases are known to be complete.
 */
export function groupIntoSuites(cases: readonly CaseWithFile[]): Suite[] {
  const byFile = new Map<string, CaseWithFile[]>();
  for (const entry of cases) {
    const existing = byFile.get(entry.file);
    if (existing) {
      existing.push(entry);
    } else {
      byFile.set(entry.file, [entry]);
    }
  }

  const suites: Suite[] = [];
  for (const [file, entries] of byFile) {
    let kept = entries;
    if (kept.length > MAX_CASES_PER_SUITE) {
      logger.warn(
        `suite "${file}" produced ${kept.length} cases, over the server's limit of ${MAX_CASES_PER_SUITE}; the rest were dropped.`,
      );
      kept = kept.slice(0, MAX_CASES_PER_SUITE);
    }

    // Browsers are per-project, and one spec file can run under several
    // projects (chromium + firefox + webkit). Report the distinct set rather
    // than whichever happened to finish last.
    const browsers = [...new Set(kept.map((e) => e.browser).filter((b): b is string => Boolean(b)))].sort();

    suites.push({
      name: file,
      category: 'jest',
      duration: kept.reduce((sum, e) => sum + e.testCase.duration, 0),
      ...(browsers.length > 0 ? { browser: browsers.join(', ') } : {}),
      cases: kept.map((e) => e.testCase),
    });
  }

  if (suites.length > MAX_SUITES_PER_LAUNCH) {
    logger.warn(
      `this run produced ${suites.length} suites, over the server's limit of ${MAX_SUITES_PER_LAUNCH}; the rest were dropped.`,
    );
    return suites.slice(0, MAX_SUITES_PER_LAUNCH);
  }
  return suites;
}
