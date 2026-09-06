# Configuration

Options go in the reporter tuple in `jest.config.js`:

```ts
const { qualflareReporter } = require('@qualflare/jest');

/** @type {import('jest').Config} */
module.exports = {
  reporters: ['default', qualflareReporter({ environment: 'staging' })],
};
```

**Precedence, highest first:** the option you pass → `QUALFLARE_*` → `QF_*` (a compat alias with the
Go CLI, where one exists) → auto-detection (branch/commit/CI/shard only) → a hardcoded default.

There is **no `token` option**. This reporter makes no network calls, so it has no credential —
`qf login` holds it instead.

> This table reflects the actual option set in `src/config/resolve-config.ts`. If the two ever
> drift, regenerate it from that file, not from memory.

| Option | Env var(s) | Default | Notes |
|---|---|---|---|
| `outputDir` | `QUALFLARE_OUTPUT_DIR` | `./qualflare-results` | Directory this process writes its report file into. Relative paths resolve against the Jest project root, not the shell's cwd. Every file is uniquely named, so parallel shards can share one directory safely. |
| `shardIndex` | `QUALFLARE_SHARD_INDEX` | auto | 0-based shard position, stamped on every case. Auto-detected from Jest's own `--shard i/N` (whose index is 1-based, and is converted). An attribution label only — `qualflare-cli` merges by directory contents, never by this. |
| `runId` | `QUALFLARE_RUN_ID` | CI run id, else a per-process UUID | Identifies the run a report belongs to. Every shard of one CI run resolves the same value (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, …), so `qf collect` can tell shards of this run apart from a file left over by an earlier one and refuse to merge them. Needs `@qualflare/cli` v0.1.19+. Only set it yourself if your CI is not auto-detected and you shard. |
| `enabled` | `QUALFLARE_ENABLED` | `true` | `false` makes the reporter a complete no-op rather than throwing. |
| `environment` | `QUALFLARE_ENVIRONMENT` → `QF_ENVIRONMENT` | `development` | **The environment's uid (slug), not its display name** — see below. Must be non-empty; an explicit `''` falls back to the default rather than failing the launch later at `collect`. |
| `language` | `QUALFLARE_LANGUAGE` → `QF_LANGUAGE` | `en-US` | Same non-empty treatment. |
| `framework` | — | `jest` | Same non-empty treatment. Becomes `suites[].category` on the wire — the value api-service validates against its `test_type` enum. |
| `platform` | — | `web` | One of `android`, `ios`, `desktop`, `web`, `api`. |
| `milestone` | `QUALFLARE_MILESTONE` → `QF_MILESTONE` | `null` | A value `< 1` normalizes to `null`. |
| `branch` | `QUALFLARE_BRANCH` → `QF_BRANCH` | auto-detected, else `null` | An explicit `null` is respected as "do not auto-detect" and skips the `git` subprocess. |
| `commit` | `QUALFLARE_COMMIT` → `QF_COMMIT` | auto-detected, else `null` | Same. |
| `os` | — | `os.type() os.release()` | |
| `browser` | — | unset | Jest is node-first and an ordinary run has no browser; set it explicitly if you are using browser mode. |
| `properties` | — | unset | Arbitrary `Record<string, string>` attached to the launch. |
| `ciProvider` | — | auto-detected | |
| `ciBuildNumber` | — | auto-detected | |
| `ciRunUrl` | — | auto-detected | |
| `ciPrNumber` | — | auto-detected | |
| `maxAttachmentBytes` | `QUALFLARE_MAX_ATTACHMENT_BYTES` | `5000000` (5MB) | Per-attachment cap. Anything larger is skipped with a warning rather than truncated. The server's own ceiling is 50MB per file, so this can be raised. |
| `maxTotalAttachmentBytes` | `QUALFLARE_MAX_TOTAL_ATTACHMENT_BYTES` | `10000000` (10MB) | Whole-run attachment budget; once spent, further attachments are skipped. Counted in **encoded** bytes — base64 is what the report carries, so a 1MB file spends ~1.34MB of this. It was 750KB while attachments were base64-inlined into `/collect`'s 10MB body — `@qualflare/cli` v0.1.22+ uploads them out of band, so this now bounds only the report file on disk. Videos, traces and **screenshots** are exempt; they are copied into `outputDir`, not inlined. What this budget still bounds is text — logs, JSON, markdown. |
| `debug` | `QUALFLARE_DEBUG` → `QF_DEBUG` | `false` | Extra detail on stderr. |

## Branch and commit auto-detection

1. The `branch`/`commit` option, if given. An explicit `null` means "do not detect".
2. `QUALFLARE_BRANCH`/`QF_BRANCH` (and the commit equivalents).
3. CI provider environment variables.
4. A `git` subprocess.

The subprocess is skipped entirely when both values are already resolved by an earlier tier, so a
CI run that sets them never forks `git`.

## `environment` is matched by uid, not display name

The server resolves this value against the environment's **uid** (its slug), not the name shown in
the UI:

```sql
SELECT * FROM environments WHERE project_id = $1 AND uid = $2;
```

So an environment displayed as **Staging** is almost certainly `staging` here. Passing the display
name verbatim is the common mistake, and it does not fail at test time — the reporter has no
network access and cannot know the value is wrong, so the run completes and writes a perfectly
valid report. It fails later, when `qualflare-cli collect` uploads it and the lookup misses:

```
environment 'Staging' not found   (404)
```

If `collect` 404s on an environment you can plainly see in the UI, check the uid on the project's
environment settings page and use that.

## CI metadata auto-detection

Provider, build number, run URL and PR number are detected for GitHub Actions, GitLab CI, CircleCI,
Buildkite, Jenkins, Azure Pipelines and Bitbucket Pipelines. Each field can be overridden
independently — setting `ciBuildNumber` by hand leaves the other three auto-detected.

## Shard detection

Jest exposes `--shard i/N` on the resolved config as `globalConfig.shard` ({ shardIndex, shardCount }),
which the reporter reads in its constructor, so nothing needs configuring for sharded CI. Note Jest's
`index` is **1-based** (`--shard=1/3` is the first shard) while Qualflare's `shardIndex` is 0-based;
the reporter converts it.

Jest and Playwright both hand this to the reporter directly. Cypress has no shard concept at all,
and cucumber-js hides its own `--shard` from formatters entirely, forcing a `process.argv` scrape.
