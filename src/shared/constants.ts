/**
 * Shared constants used across the reporter and the author-facing runtime
 * API.
 */

/** Directory prefix for the metadata side-channel, under `os.tmpdir()`.
 *
 * Jest runs tests in WORKER processes and reporters in the MAIN process, and
 * offers no user-writable per-test meta channel between them — no equivalent of
 * Vitest's `task.meta`, which is serialized from worker to reporter for free.
 * Nor are we taking over `testEnvironment`: that slot is frequently already
 * occupied by a user's own environment, which is why Allure's Jest integration
 * has to ship separate `/node` and `/jsdom` builds.
 *
 * So the in-worker runtime appends NDJSON here and the reporter drains it. The
 * directory is suffixed with the MAIN process's pid, which both sides can
 * derive without configuration: the reporter is in that process, and a worker
 * reaches it through `process.ppid`. Two concurrent Jest runs on one machine
 * therefore cannot collide.
 *
 * Under `--runInBand` there are no workers at all, so nothing is written — see
 * `runtime/channel.ts`, which switches to an in-memory store. */
export const CHANNEL_DIR_PREFIX = 'qualflare-jest-';

/** Server-side caps this client should respect defensively (see
 * `api-service/internal/core/domain/launch/launch.go`). */
export const MAX_SUITES_PER_LAUNCH = 2000;
export const MAX_CASES_PER_SUITE = 5000;
export const MAX_STEPS_PER_CASE = 1000;
export const MAX_PARAMETERS_PER_STEP = 50;
export const MAX_ATTACHMENTS_PER_CASE = 50;
export const MAX_LABELS_PER_CASE = 100;
export const MAX_LINKS_PER_CASE = 20;
export const MAX_TAGS_PER_CASE = 64;
export const MAX_TAG_LENGTH = 255;

/** Client-side SOFT cap on steps recorded per test attempt — well under
 * the server's 1000-per-case hard cap (`MAX_STEPS_PER_CASE`). Once hit,
 * further steps within that attempt are dropped (with a one-time warning),
 * not queued and truncated later. */
export const MAX_STEPS_PER_TEST_ATTEMPT = 300;

/**
 * Server-side bounds on `Case.attempts`, mirrored client-side so the bytes are
 * never sent rather than truncated on arrival. Values match the sibling
 * reporters and `case_run_attempts`.
 */
export const MAX_ATTEMPTS_PER_CASE = 50;
export const MAX_ATTEMPT_MESSAGE_RUNES = 8192;
export const MAX_ATTEMPT_TRACE_RUNES = 32768;

/** Bounds on the per-attempt fields Jest can fill that Vitest could not.
 * `TestResult.console` gives captured stdout/stderr per test file, so unlike
 * `@qualflare/vitest` this reporter has real output to clamp — which is why it
 * takes the full `shared/text.ts` (with `clampOutputLines`) rather than the
 * truncate-only subset. */
export const MAX_ATTEMPT_SNIPPET_RUNES = 4096;
export const MAX_ATTEMPT_OUTPUT_RUNES = 16384;
export const MAX_ATTEMPT_OUTPUT_LINES = 200;
