import { execFileSync } from 'node:child_process';

/** Auto-detected branch/commit — the bottom tier of `resolve-config.ts`'s
 * precedence chain (option > QUALFLARE_BRANCH/QF_BRANCH env > CI env vars >
 * local git subprocess > null). Does NOT include the QUALFLARE_BRANCH/
 * QF_BRANCH-style env aliases — those are resolved at a higher tier,
 * directly in `resolve-config.ts`, before this module is ever consulted. */
export interface GitInfo {
  branch?: string;
  commit?: string;
}

/** Injectable so tests never actually shell out. `stdio: ['ignore', 'pipe',
 * 'ignore']` suppresses git's own stderr chatter (e.g. "fatal: not a git
 * repository") from leaking into the CI log for what is, from this plugin's
 * perspective, an entirely expected, non-fatal outcome. */
export type ExecGit = (args: string[], cwd: string) => string;

const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function firstEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function detectBranchFromGit(exec: ExecGit, cwd: string): string | undefined {
  try {
    // Empty on detached HEAD (the `-q` flag suppresses the error and the
    // command still exits 0 with no output in that case on some git
    // versions, hence the explicit empty-string check as well as the
    // try/catch for versions that exit non-zero instead).
    const out = exec(['symbolic-ref', '--short', '-q', 'HEAD'], cwd).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function detectCommitFromGit(exec: ExecGit, cwd: string): string | undefined {
  try {
    const out = exec(['rev-parse', 'HEAD'], cwd).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Auto-detects branch/commit: CI-provider env vars first (cheap, no
 * subprocess), falling back to a local `git` subprocess only for whichever
 * of branch/commit the env vars didn't resolve — mirroring
 * `qualflare-cli/internal/config/config.go`'s `LoadFromEnv`
 * (`getFirstEnv("GIT_BRANCH", "GITHUB_REF_NAME", "CI_COMMIT_REF_NAME",
 * "BITBUCKET_BRANCH")` / the equivalent commit chain) and its `DetectGit`'s
 * "only shell out for what's actually missing" behavior (BUG-39 in that
 * file: forking `git` on every CLI invocation, even `--help`, was wasteful —
 * the same reasoning applies here, this reporter should not fork two `git`
 * processes on every Vitest run when CI env vars already cover both
 * values, or when the caller already resolved both from options/env at a
 * higher precedence tier and doesn't need this module at all).
 */
export function detectGit(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  exec: ExecGit = defaultExecGit,
): GitInfo {
  const branch =
    firstEnv(env, 'GIT_BRANCH', 'GITHUB_REF_NAME', 'CI_COMMIT_REF_NAME', 'BITBUCKET_BRANCH') ??
    detectBranchFromGit(exec, cwd);
  const commit =
    firstEnv(env, 'GIT_COMMIT', 'GITHUB_SHA', 'CI_COMMIT_SHA', 'BITBUCKET_COMMIT') ??
    detectCommitFromGit(exec, cwd);

  const result: GitInfo = {};
  if (branch !== undefined) result.branch = branch;
  if (commit !== undefined) result.commit = commit;
  return result;
}
