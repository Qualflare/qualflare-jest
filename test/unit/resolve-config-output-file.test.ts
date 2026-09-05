import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../../src/config/resolve-config.js';

// No git/CI detection matters for these assertions — stub both so nothing
// forks a `git` subprocess or reads the ambient environment.
const NOOP_DEPS = { detectGit: () => ({}), detectCi: () => ({}) };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveConfig — outputDir', () => {
  it('defaults outputDir to ./qualflare-results', () => {
    expect(resolveConfig({}, NOOP_DEPS).outputDir).toBe('./qualflare-results');
  });

  it('honors an explicit outputDir option', () => {
    expect(resolveConfig({ outputDir: './custom' }, NOOP_DEPS).outputDir).toBe('./custom');
  });

  it('resolves outputDir from QUALFLARE_OUTPUT_DIR', () => {
    vi.stubEnv('QUALFLARE_OUTPUT_DIR', './from-env');
    expect(resolveConfig({}, NOOP_DEPS).outputDir).toBe('./from-env');
  });

  it('an explicit option beats the environment variable', () => {
    vi.stubEnv('QUALFLARE_OUTPUT_DIR', './from-env');
    expect(resolveConfig({ outputDir: './from-option' }, NOOP_DEPS).outputDir).toBe('./from-option');
  });

  it('an explicit outputDir: "" falls through to the default', () => {
    expect(resolveConfig({ outputDir: '' }, NOOP_DEPS).outputDir).toBe('./qualflare-results');
  });

  it('never demands a token — this reporter makes no network calls', () => {
    expect(() => resolveConfig({}, NOOP_DEPS)).not.toThrow();
  });
});

describe('resolveConfig — shardIndex', () => {
  it('is undefined when nothing indicates a shard', () => {
    expect(resolveConfig({}, NOOP_DEPS).shardIndex).toBeUndefined();
  });

  it('honors an explicit shardIndex option', () => {
    expect(resolveConfig({ shardIndex: 9 }, NOOP_DEPS).shardIndex).toBe(9);
  });

  it('reads QUALFLARE_SHARD_INDEX', () => {
    vi.stubEnv('QUALFLARE_SHARD_INDEX', '3');
    expect(resolveConfig({}, NOOP_DEPS).shardIndex).toBe(3);
  });

  it('falls back to the shard index the reporter read from Vitest', () => {
    // The reporter converts FullConfig.shard.current (1-based) before passing
    // it in; resolveConfig receives an already-0-based value.
    expect(resolveConfig({}, { ...NOOP_DEPS, detectedShardIndex: 0 }).shardIndex).toBe(0);
  });

  it('prefers the env var over Vitest’s own shard, and an option over both', () => {
    vi.stubEnv('QUALFLARE_SHARD_INDEX', '7');
    expect(resolveConfig({}, { ...NOOP_DEPS, detectedShardIndex: 1 }).shardIndex).toBe(7);
    expect(resolveConfig({ shardIndex: 9 }, { ...NOOP_DEPS, detectedShardIndex: 1 }).shardIndex).toBe(9);
  });
});

describe('resolveConfig — required-non-empty wire fields', () => {
  // These three use `||` rather than `??` on purpose: an explicit '' must not
  // beat the default. The server rejects an empty environment, and because
  // this reporter never uploads, that rejection would only surface much later
  // at `qf collect` — far from the config that caused it.
  it('an explicit empty string falls back to the default', () => {
    const config = resolveConfig({ environment: '', language: '', framework: '' }, NOOP_DEPS);
    expect(config.environment).toBe('development');
    expect(config.language).toBe('en-US');
    expect(config.framework).toBe('jest');
  });

  it('defaults framework to jest', () => {
    expect(resolveConfig({}, NOOP_DEPS).framework).toBe('jest');
  });
});
