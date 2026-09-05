import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { groupIntoSuites, relativizeFile, type CaseWithFile } from '../../src/reporter/suite-builder.js';
import type { Case } from '../../src/shared/types.js';

function testCase(name: string, duration = 1_000_000): Case {
  return { id: name, name, status: 'passed', duration };
}

function entry(file: string, name: string, browser?: string): CaseWithFile {
  return { file, ...(browser ? { browser } : {}), testCase: testCase(name) };
}

describe('relativizeFile', () => {
  it('relativizes an absolute path against rootDir', () => {
    const root = path.resolve('/repo');
    expect(relativizeFile(path.join(root, 'tests', 'a.spec.ts'), root)).toBe('tests/a.spec.ts');
  });

  it('leaves an already-relative path alone', () => {
    expect(relativizeFile('tests/a.spec.ts', path.resolve('/repo'))).toBe('tests/a.spec.ts');
  });

  it('always emits POSIX separators', () => {
    // The same spec run on Windows and Linux must be ONE suite server-side,
    // not two that differ only by slash direction.
    const out = relativizeFile(path.join('tests', 'nested', 'a.spec.ts'), path.resolve('/repo'));
    expect(out).toBe('tests/nested/a.spec.ts');
    expect(out).not.toContain('\\');
  });
});

describe('groupIntoSuites', () => {
  it('groups one suite per spec file, preserving case order', () => {
    const suites = groupIntoSuites([
      entry('a.spec.ts', 'one'),
      entry('b.spec.ts', 'two'),
      entry('a.spec.ts', 'three'),
    ]);

    expect(suites.map((s) => s.name)).toEqual(['a.spec.ts', 'b.spec.ts']);
    expect(suites[0]!.cases.map((c) => c.name)).toEqual(['one', 'three']);
    expect(suites.every((s) => s.category === 'jest')).toBe(true);
  });

  it('sums case durations into the suite duration', () => {
    const suites = groupIntoSuites([entry('a.spec.ts', 'one'), entry('a.spec.ts', 'two')]);
    expect(suites[0]!.duration).toBe(2_000_000);
  });

  // NOTE: this reporter never populates `browser` -- Jest is node-first and
  // `reporter.ts` pushes `{ file, testCase }` with no browser. The two tests
  // below cover groupIntoSuites' contract, which is shared shape with the
  // sibling packages, not a path a Jest run can currently reach.
  it('reports the distinct browser set when one spec runs under several projects', () => {
    // The same file under chromium + firefox is one suite; reporting only
    // whichever finished last would silently misattribute it.
    const suites = groupIntoSuites([
      entry('a.spec.ts', 'one', 'chromium'),
      entry('a.spec.ts', 'one', 'firefox'),
    ]);
    expect(suites[0]!.browser).toBe('chromium, firefox');
  });

  it('omits browser entirely when nothing reported one', () => {
    expect(groupIntoSuites([entry('a.spec.ts', 'one')])[0]!.browser).toBeUndefined();
  });

  it('caps cases per suite rather than letting the server reject the launch', () => {
    const many = Array.from({ length: 5100 }, (_, i) => entry('a.spec.ts', `case-${i}`));
    expect(groupIntoSuites(many)[0]!.cases).toHaveLength(5000);
  });

  it('caps suites per launch', () => {
    const many = Array.from({ length: 2100 }, (_, i) => entry(`spec-${i}.spec.ts`, 'one'));
    expect(groupIntoSuites(many)).toHaveLength(2000);
  });

  it('returns nothing for no cases, so the reporter can skip the file write', () => {
    expect(groupIntoSuites([])).toEqual([]);
  });
});
