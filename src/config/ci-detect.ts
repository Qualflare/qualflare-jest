import * as ciInfo from 'ci-info';

/** Detected CI pipeline metadata, matching the wire contract's `ciProvider`/
 * `ciBuildNumber`/`ciRunUrl`/`ciPrNumber` fields exactly (`src/shared/types.ts`). */
export interface CiMetadata {
  ciProvider?: string;
  ciBuildNumber?: string;
  ciRunUrl?: string;
  ciPrNumber?: number;
  /** Identifier every shard of ONE CI run shares, and which differs between
   * runs. Distinct from `ciBuildNumber`: a build number is the human-facing
   * counter (GitHub's run NUMBER, which repeats across re-runs of the same
   * workflow), whereas this is the unique run id. `qualflare-cli collect`
   * groups report files by it to refuse merging a stale file from an earlier
   * run into the current launch. */
  ciRunId?: string;
}

interface ProviderExtractor {
  detect: (env: NodeJS.ProcessEnv) => boolean;
  providerName: string;
  buildNumber?: (env: NodeJS.ProcessEnv) => string | undefined;
  runUrl?: (env: NodeJS.ProcessEnv) => string | undefined;
  runId?: (env: NodeJS.ProcessEnv) => string | undefined;
  prNumber?: (env: NodeJS.ProcessEnv) => number | undefined;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

function nonEmpty(raw: string | undefined): string | undefined {
  return raw && raw.length > 0 ? raw : undefined;
}

/** Explicit per-provider extraction for the fields `ci-info` doesn't
 * standardize (build number / run URL / PR number). Each `detect` reads
 * directly off the passed-in `env` — deliberately NOT delegating to
 * `ci-info`'s own per-vendor booleans (e.g. `ciInfo.GITHUB_ACTIONS`), which
 * are computed once against the real `process.env` at module-import time
 * and can't be re-evaluated against an injected env — see the module-level
 * comment on `detectCi` below. Checked in order; first match wins. */
const PROVIDERS: ProviderExtractor[] = [
  {
    detect: (env) => env.GITHUB_ACTIONS === 'true',
    providerName: 'GitHub Actions',
    buildNumber: (env) => nonEmpty(env.GITHUB_RUN_NUMBER),
    runId: (env) => nonEmpty(env.GITHUB_RUN_ID),
    runUrl: (env) =>
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : undefined,
    prNumber: (env) => {
      const match = /^refs\/pull\/(\d+)\/merge$/.exec(env.GITHUB_REF ?? '');
      return match ? parsePositiveInt(match[1]) : undefined;
    },
  },
  {
    detect: (env) => env.GITLAB_CI === 'true',
    providerName: 'GitLab CI',
    buildNumber: (env) => nonEmpty(env.CI_PIPELINE_IID),
    runId: (env) => nonEmpty(env.CI_PIPELINE_ID),
    runUrl: (env) => nonEmpty(env.CI_PIPELINE_URL),
    prNumber: (env) => parsePositiveInt(env.CI_MERGE_REQUEST_IID),
  },
  {
    detect: (env) => env.CIRCLECI === 'true',
    providerName: 'CircleCI',
    buildNumber: (env) => nonEmpty(env.CIRCLE_BUILD_NUM),
    runId: (env) => nonEmpty(env.CIRCLE_WORKFLOW_ID ?? env.CIRCLE_BUILD_NUM),
    runUrl: (env) => nonEmpty(env.CIRCLE_BUILD_URL),
    prNumber: (env) => parsePositiveInt(env.CIRCLE_PR_NUMBER),
  },
  {
    detect: (env) => env.BUILDKITE === 'true',
    providerName: 'Buildkite',
    buildNumber: (env) => nonEmpty(env.BUILDKITE_BUILD_NUMBER),
    runId: (env) => nonEmpty(env.BUILDKITE_BUILD_ID),
    runUrl: (env) => nonEmpty(env.BUILDKITE_BUILD_URL),
    prNumber: (env) => {
      const raw = env.BUILDKITE_PULL_REQUEST;
      if (!raw || raw === 'false') {
        return undefined;
      }
      return parsePositiveInt(raw);
    },
  },
  {
    // Jenkins has no simple `JENKINS=true`-style flag; JENKINS_URL is always
    // set by the Jenkins agent and is the conventional detection signal.
    detect: (env) => Boolean(env.JENKINS_URL),
    providerName: 'Jenkins',
    buildNumber: (env) => nonEmpty(env.BUILD_NUMBER),
    runId: (env) => nonEmpty(env.BUILD_TAG ?? env.BUILD_NUMBER),
    runUrl: (env) => nonEmpty(env.BUILD_URL),
    // Jenkins has no standardized PR-number env var across its many PR
    // plugins (Multibranch, GitHub Branch Source, etc.) — deliberately
    // omitted rather than guessing at a plugin-specific variable.
  },
  {
    detect: (env) => env.TF_BUILD === 'True' || env.TF_BUILD === 'true',
    providerName: 'Azure Pipelines',
    buildNumber: (env) => nonEmpty(env.BUILD_BUILDID),
    runId: (env) => nonEmpty(env.BUILD_BUILDID),
    runUrl: (env) => {
      const collectionUri = env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
      const project = env.SYSTEM_TEAMPROJECT;
      const buildId = env.BUILD_BUILDID;
      if (!collectionUri || !project || !buildId) {
        return undefined;
      }
      return `${collectionUri.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
    },
    prNumber: (env) => parsePositiveInt(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER),
  },
  {
    detect: (env) => Boolean(env.BITBUCKET_BUILD_NUMBER),
    providerName: 'Bitbucket Pipelines',
    buildNumber: (env) => nonEmpty(env.BITBUCKET_BUILD_NUMBER),
    runId: (env) => nonEmpty(env.BITBUCKET_BUILD_NUMBER),
    runUrl: (env) => {
      const origin = env.BITBUCKET_GIT_HTTP_ORIGIN;
      if (!origin) {
        return undefined;
      }
      const resultsId = env.BITBUCKET_PIPELINE_UUID ?? env.BITBUCKET_BUILD_NUMBER;
      return resultsId ? `${origin}/addon/pipelines/home#!/results/${resultsId}` : undefined;
    },
    prNumber: (env) => parsePositiveInt(env.BITBUCKET_PR_ID),
  },
];

/**
 * Detects CI pipeline metadata for the `Collect.ciProvider`/`ciBuildNumber`/
 * `ciRunUrl`/`ciPrNumber` fields.
 *
 * IMPORTANT, non-obvious limitation: the `env` parameter only governs the
 * `PROVIDERS` table above (this module's own, directly-env-reading logic).
 * The `ci-info` fallback below does NOT honor it — `ci-info`'s package source
 * computes `exports.name`/`exports.isCI` exactly once, against the REAL
 * `process.env`, at module-import time (`const env = process.env` at its top
 * level) — there is no API to re-evaluate it against a different env object.
 * This is a non-issue in production (this function is always called against
 * the real `process.env` there); `ci-detect.test.ts` exercises the `ci-info`
 * fallback path via `vi.stubEnv` + `vi.resetModules()` (forcing a fresh
 * `ci-info` evaluation) rather than via this function's `env` parameter.
 */
export function detectCi(env: NodeJS.ProcessEnv = process.env): CiMetadata {
  const provider = PROVIDERS.find((p) => p.detect(env));
  if (provider) {
    const result: CiMetadata = { ciProvider: provider.providerName };
    const buildNumber = provider.buildNumber?.(env);
    if (buildNumber !== undefined) result.ciBuildNumber = buildNumber;
    const runUrl = provider.runUrl?.(env);
    if (runUrl !== undefined) result.ciRunUrl = runUrl;
    const prNumber = provider.prNumber?.(env);
    if (prNumber !== undefined) result.ciPrNumber = prNumber;
    const runId = provider.runId?.(env);
    if (runId !== undefined) result.ciRunId = runId;
    return result;
  }

  // Fallback: ci-info's ~70-provider detection gives us a free-text provider
  // name (the server's `ciProvider` field has no enum — an unrecognized
  // value is always accepted, per its doc comment in shared/types.ts) even
  // for providers our explicit table above doesn't cover a full
  // build-number/run-URL/PR-number extraction for.
  if (ciInfo.name) {
    return { ciProvider: ciInfo.name };
  }
  return {};
}
