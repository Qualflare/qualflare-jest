import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../../src/config/resolve-config.js';
import { detectCi } from '../../src/config/ci-detect.js';

const NOOP_DEPS = {
  detectGit: () => ({ branch: null, commit: null }),
  detectCi: () => ({}),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runId resolution', () => {
  it('is never empty — a blank one would silently opt the run out of the check', () => {
    // `qf collect` treats a report with no runId as "unknown run" and never
    // lets it block a merge. If this ever resolved to '' or undefined, local
    // runs would quietly lose the stale-file protection entirely.
    const config = resolveConfig({}, NOOP_DEPS);
    expect(config.runId).toBeTruthy();
    expect(typeof config.runId).toBe('string');
  });

  it('differs between two local runs, so a leftover file is still caught', () => {
    const a = resolveConfig({}, NOOP_DEPS);
    const b = resolveConfig({}, NOOP_DEPS);
    expect(a.runId).not.toBe(b.runId);
  });

  it('is IDENTICAL across reporter instances in one CI run — the property sharding needs', () => {
    // Two shards are two processes with the same CI env. If they disagreed,
    // collect would reject every sharded upload, which is the exact workflow
    // the reporters exist to support.
    const ci = () => ({ ciProvider: 'GitHub Actions', ciRunId: '17244981923' });
    const shard0 = resolveConfig({}, { ...NOOP_DEPS, detectCi: ci });
    const shard1 = resolveConfig({}, { ...NOOP_DEPS, detectCi: ci });
    expect(shard0.runId).toBe('17244981923');
    expect(shard1.runId).toBe(shard0.runId);
  });

  it('prefers an explicit option, then the env var, then CI', () => {
    const ci = () => ({ ciRunId: 'from-ci' });
    expect(resolveConfig({ runId: 'explicit' }, { ...NOOP_DEPS, detectCi: ci }).runId).toBe('explicit');

    vi.stubEnv('QUALFLARE_RUN_ID', 'from-env');
    expect(resolveConfig({}, { ...NOOP_DEPS, detectCi: ci }).runId).toBe('from-env');
    vi.unstubAllEnvs();

    expect(resolveConfig({}, { ...NOOP_DEPS, detectCi: ci }).runId).toBe('from-ci');
  });
});

describe('detectCi — ciRunId', () => {
  it('reads a run id distinct from the build number on GitHub Actions', () => {
    // GITHUB_RUN_NUMBER repeats across re-runs of the same workflow, so it is
    // NOT usable as a run identity; GITHUB_RUN_ID is unique per run.
    const ci = detectCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_NUMBER: '42',
      GITHUB_RUN_ID: '17244981923',
    } as NodeJS.ProcessEnv);
    expect(ci.ciRunId).toBe('17244981923');
    expect(ci.ciBuildNumber).toBe('42');
    expect(ci.ciRunId).not.toBe(ci.ciBuildNumber);
  });

  it('reads GitLab pipeline id', () => {
    const ci = detectCi({ GITLAB_CI: 'true', CI_PIPELINE_ID: '9911', CI_PIPELINE_IID: '7' } as NodeJS.ProcessEnv);
    expect(ci.ciRunId).toBe('9911');
  });

  it('leaves ciRunId unset outside a recognised CI', () => {
    expect(detectCi({} as NodeJS.ProcessEnv).ciRunId).toBeUndefined();
  });
});
