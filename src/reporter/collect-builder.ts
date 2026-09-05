import * as os from 'node:os';

import { PACKAGE_VERSION } from '../config/version.js';
import type { ResolvedReporterConfig } from '../config/resolve-config.js';
import type { Collect, Suite } from '../shared/types.js';

function resolveOs(config: ResolvedReporterConfig): string {
  if (config.os) {
    return config.os;
  }
  return `${os.type()} ${os.release()}`;
}

/**
 * Launch-level browser.
 *
 * Jest is a node-first runner: an ordinary run has no browser at all, so
 * this is empty unless the user sets `browser` explicitly. The field is kept
 * rather than removed because the wire contract carries it and Jest's
 * browser mode gives it a real meaning.
 */
function resolveBrowser(config: ResolvedReporterConfig, browsers: readonly string[]): string {
  if (config.browser) {
    return config.browser;
  }
  return [...new Set(browsers)].sort().join(', ');
}

/**
 * Assembles the final `Collect` payload at `onRunComplete`.
 *
 * CI metadata and branch/commit detection are already fully resolved by
 * `resolve-config.ts` — this reads the resolved config through and does NOT
 * call `ci-detect`/`git-detect` itself, matching both sibling packages.
 *
 * `metadata` is not optional decoration: `qualflare-cli` identifies this
 * format by the presence of `framework` + `metadata` + `suites` together.
 * Omitting it makes the CLI fall back to filename matching, where a file
 * whose name contains a framework name is routed to that framework's own
 * parser and fails. For the same reason this payload must never grow a
 * top-level `config` key — that is the Playwright-JSON detector's signature.
 *
 * `framework` is what becomes `suites[].category` on the wire, and is the
 * value api-service validates against its test_type enum. It resolves to
 * `jest`, which migration 0242 added.
 */
export function buildCollectPayload(
  suites: Suite[],
  config: ResolvedReporterConfig,
  browsers: readonly string[] = [],
): Collect {
  return {
    framework: config.framework,
    platform: config.platform,
    os: resolveOs(config),
    browser: resolveBrowser(config, browsers),
    branch: config.branch,
    commit: config.commit,
    environment: config.environment,
    language: config.language,
    milestone: config.milestone,
    metadata: {
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString(),
      cliName: 'qualflare-jest',
      runId: config.runId,
    },
    properties: config.properties,
    suites,
    ciProvider: config.ciProvider,
    ciBuildNumber: config.ciBuildNumber,
    ciRunUrl: config.ciRunUrl,
    ciPrNumber: config.ciPrNumber,
  };
}
