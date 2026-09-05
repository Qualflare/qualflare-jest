import type { ResolvedReporterConfig } from '../config/resolve-config.js';
import {
  MAX_ATTEMPT_MESSAGE_RUNES,
  MAX_ATTEMPT_OUTPUT_LINES,
  MAX_ATTEMPT_OUTPUT_RUNES,
  MAX_ATTACHMENTS_PER_CASE,
  MAX_ATTEMPTS_PER_CASE,
  MAX_LABELS_PER_CASE,
  MAX_LINKS_PER_CASE,
  MAX_PARAMETERS_PER_STEP,
  MAX_STEPS_PER_TEST_ATTEMPT,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CASE,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import { propertyValue } from '../shared/parameters.js';
import { clampOutputLines, truncateRunes } from '../shared/text.js';
import type {
  Attachment,
  Attempt,
  Case,
  CaseStatus,
  Label,
  Link,
  Parameter,
  Step,
} from '../shared/types.js';
import type { RuntimeMessage } from '../runtime/message-types.js';
import { msToNs } from '../shared/duration.js';
import { AttachmentBudget, inlineFromBuffer, inlineFromFile } from './attachment-reader.js';
import { copyImageAttachment, isOffloadableImage, writeImageAttachment } from './image-writer.js';
import type { JestAssertionResult } from './reporter.js';

/**
 * Maps Jest's statuses onto the wire contract's vocabulary.
 *
 * `qualflare-cli` accepts exactly 7 values and turns anything it does not
 * recognize into `error` — NOT into a pass — so each is mapped explicitly
 * rather than passed through and hoped for.
 *
 * Jest has no `timedOut` state: a timeout surfaces as `failed` carrying a
 * timeout message, so this reporter never produces `timeout` or `aborted`.
 * `todo` and `disabled` are Jest-specific and both mean "not executed".
 */
function mapStatus(status: string): CaseStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'skipped':
    case 'todo':
    case 'disabled':
      return 'skipped';
    // The seventh member of Jest's Status union, and the one most easily
    // missed. Without this it fell to `default: 'failed'` and a focused test
    // uploaded as a FAILURE -- a false red, which is worse than an unknown.
    case 'focused':
      return 'passed';
    default:
      return 'failed';
  }
}

/** Jest reports failures as pre-rendered strings, message and stack already
 * joined. There is no separate stack field to read, so splitting on the first
 * newline to fill `trace` would corrupt every multiline assertion message —
 * which Jest produces routinely. The whole text goes in `message`. */
function joinFailures(failureMessages: readonly string[]): string | undefined {
  const joined = failureMessages.filter((m) => m).join('\n\n');
  return joined === '' ? undefined : joined;
}

/**
 * Builds per-attempt history from what Jest reports directly.
 *
 * This is where Jest beats Vitest. Vitest exposes no per-attempt array, so its
 * reporter has to RECONSTRUCT the history by counting errors and reasoning
 * about which executions must have failed — and gives up entirely when
 * `expect.soft()` blurs the boundaries. Jest hands it over:
 *
 *   invocations   total executions (1 + retries)
 *   retryReasons  the error from each attempt that failed, in order
 *
 * The final attempt carries the case's own outcome; every earlier one failed by
 * construction, because a pass ends the retry loop.
 *
 * BUT `retryReasons` IS OPT-IN. Verified against Jest 30.5.1: with a plain
 * `jest.retryTimes(2)` it comes back EMPTY, and it is only populated when the
 * user passes `jest.retryTimes(2, { logErrorsBeforeRetry: true })`. So the
 * attempt STRUCTURE (how many, which passed) is always available, while the
 * per-attempt error text requires that flag.
 *
 * The structure is still emitted without it — knowing a test failed twice
 * before passing is worth recording on its own — and `hintIfErrorsUnavailable`
 * tells the user once how to get the messages too.
 */
export function buildAttempts(
  assertion: JestAssertionResult,
  finalStatus: CaseStatus,
): Attempt[] | undefined {
  const executions = Math.max(1, assertion.invocations ?? 1);
  // Rule 2 of the contract: fewer than two attempts persists nothing server-side.
  if (executions < 2) {
    return undefined;
  }

  const reasons = assertion.retryReasons ?? [];
  hintIfErrorsUnavailable(reasons.length, executions);
  const built: Attempt[] = [];
  for (let i = 0; i < executions; i += 1) {
    const isFinal = i === executions - 1;
    const attempt: Attempt = {
      attempt: i + 1,
      status: isFinal ? finalStatus : 'failed',
    };
    // retryReasons covers the failed attempts in order. When the test ended
    // green there are exactly `executions - 1` of them; when it ended red the
    // final attempt's error is in failureMessages instead.
    const reason = isFinal ? joinFailures(assertion.failureMessages) : reasons[i];
    if (reason) {
      attempt.message = truncateRunes(reason, MAX_ATTEMPT_MESSAGE_RUNES);
    }
    built.push(attempt);
  }

  // Past the cap the server keeps the first 49 plus the final one and drops the
  // middle. Mirroring that here means the bytes are never sent, and the FINAL
  // attempt survives the trim — a plain slice(0, 50) would discard it.
  if (built.length > MAX_ATTEMPTS_PER_CASE) {
    return [...built.slice(0, MAX_ATTEMPTS_PER_CASE - 1), built[built.length - 1]!];
  }
  return built;
}

let hintedRetryErrors = false;

/** Says once, per process, how to get the per-attempt error text.
 *
 * Without `logErrorsBeforeRetry` the attempts are recorded with statuses and no
 * messages, which looks like a reporter bug rather than a Jest default. One
 * line of explanation is cheaper than the support question. */
function hintIfErrorsUnavailable(reasonCount: number, executions: number): void {
  if (hintedRetryErrors || reasonCount > 0 || executions < 2) {
    return;
  }
  hintedRetryErrors = true;
  logger.info(
    'per-attempt retry history is being recorded without error messages — Jest only supplies them ' +
      'when you opt in with jest.retryTimes(n, { logErrorsBeforeRetry: true }).',
  );
}

interface ReplayedMetadata {
  labels: Label[];
  links: Link[];
  tags: string[];
  description?: string;
  priority?: Case['priority'];
  caseParameters: Parameter[];
  attachments: Attachment[];
  steps: Step[];
}

/**
 * Replays the messages a test emitted into structured metadata.
 *
 * The channel is append-only and flat, so `step_start`/`step_stop` arrive as a
 * pair stream. Walking it with a stack recovers nesting exactly: the index of
 * the enclosing step becomes `parentIndex`, and parameters declared inside a
 * step attach to that step rather than to the case.
 */
export function replayMetadata(
  messages: readonly RuntimeMessage[],
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): ReplayedMetadata {
  const meta: ReplayedMetadata = {
    labels: [],
    links: [],
    tags: [],
    caseParameters: [],
    attachments: [],
    steps: [],
  };
  const openSteps: number[] = [];
  // step_start timestamps, parallel to openSteps, so step_stop can compute a
  // real duration rather than reporting every step as instantaneous.
  const openStartedAt: number[] = [];
  let warnedStepCap = false;

  for (const message of messages) {
    switch (message.type) {
      case 'label':
        meta.labels.push({ name: message.name, value: message.value });
        break;
      case 'link':
        meta.links.push({
          url: message.url,
          // `type` is required on the wire and validated server-side against
          // issue/tms/custom. 'custom' is the neutral default when the author
          // did not say.
          type: message.linkType ?? 'custom',
          ...(message.name ? { name: message.name } : {}),
        });
        break;
      case 'tag':
        meta.tags.push(...message.tags);
        break;
      case 'description':
        meta.description = message.text;
        break;
      case 'priority':
        meta.priority = message.value;
        break;
      case 'parameter': {
        const param: Parameter = {
          name: message.name,
          ...(message.value !== undefined ? { value: message.value } : {}),
          ...(message.masked ? { masked: true } : {}),
        };
        const openStep = openSteps[openSteps.length - 1];
        if (openStep === undefined) {
          meta.caseParameters.push(param);
        } else {
          const step = meta.steps[openStep];
          // Capped, and pushed rather than re-spread: the previous form
          // allocated a fresh array per parameter, which is O(n^2) on a step
          // that records many.
          if (step) {
            if (!step.parameters) {
              step.parameters = [];
            }
            if (step.parameters.length < MAX_PARAMETERS_PER_STEP) {
              step.parameters.push(param);
            }
          }
        }
        break;
      }
      case 'attachment': {
        const bytes = Buffer.from(message.contentBase64, 'base64');
        const attachment = imageFromBuffer(message.name, bytes, message.mimeType, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const inlined = inlineFromBuffer(message.name, bytes, message.mimeType, config, budget);
        if (inlined) {
          meta.attachments.push(inlined);
        }
        break;
      }
      case 'attachment_from_file': {
        const attachment = imageFromFile(message.name, message.path, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const fromFile = inlineFromFile(message.name, message.path, message.mimeType, config, budget);
        if (fromFile) {
          meta.attachments.push(fromFile);
        }
        break;
      }
      case 'step_start': {
        if (meta.steps.length >= MAX_STEPS_PER_TEST_ATTEMPT) {
          if (!warnedStepCap) {
            warnedStepCap = true;
            logger.warn(
              `a test recorded more than ${MAX_STEPS_PER_TEST_ATTEMPT} steps; the rest were dropped.`,
            );
          }
          break;
        }
        const parentIndex = openSteps[openSteps.length - 1];
        const step: Step = {
          name: message.name,
          status: 'passed',
          duration: 0,
          ...(parentIndex !== undefined ? { parentIndex } : {}),
        };
        openSteps.push(meta.steps.length);
        openStartedAt.push(message.timestamp);
        meta.steps.push(step);
        break;
      }
      case 'step_stop': {
        const index = openSteps.pop();
        const startedAt = openStartedAt.pop();
        if (index === undefined) {
          break;
        }
        const step = meta.steps[index];
        if (step) {
          step.status = message.status;
          if (startedAt !== undefined) {
            step.duration = msToNs(Math.max(0, message.timestamp - startedAt));
          }
          if (message.error) {
            step.error = message.error;
          }
        }
        break;
      }
    }
  }
  return meta;
}

/** Routes an on-disk image onto `localImagePath`, or undefined so the caller
 * falls through to inlining. Undefined is the ordinary outcome for a log or a
 * JSON blob, and also for an image the writer could not place — so a bad
 * outputDir costs the offload rather than the user's attachment. */
function imageFromFile(
  name: string,
  filePath: string,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  const copied = copyImageAttachment(filePath, config.outputDir, config.maxAttachmentBytes);
  if (!copied) {
    return undefined;
  }
  return {
    name,
    mimeType: copied.mimeType,
    localImagePath: copied.localImagePath,
    fileSize: copied.fileSize,
  };
}

/** The in-memory counterpart — the shape `qualflare.attachment()` produces. */
function imageFromBuffer(
  name: string,
  bytes: Buffer,
  mimeType: string | undefined,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  if (!isOffloadableImage(mimeType)) {
    return undefined;
  }
  const written = writeImageAttachment(bytes, mimeType, config.outputDir, config.maxAttachmentBytes);
  if (!written) {
    return undefined;
  }
  return {
    name,
    mimeType: written.mimeType,
    localImagePath: written.localImagePath,
    fileSize: written.fileSize,
  };
}

function capTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.slice(0, MAX_TAG_LENGTH);
    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS_PER_CASE) {
      break;
    }
  }
  return out;
}

/**
 * Turns one Jest assertion result plus its recorded metadata into a wire Case.
 *
 * `id` is the file-relative full name, which is what makes flaky history match
 * across runs: it stays the same for what a human would call "the same test"
 * even as the file moves between machines.
 */
export function buildCase(
  assertion: JestAssertionResult,
  /** RELATIVE to the Jest rootDir. An absolute path would leak the CI agent's
   * directory layout into the report and make the same test look like a
   * different one on another machine. */
  testFilePath: string,
  messages: readonly RuntimeMessage[],
  consoleLines: readonly string[],
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): Case | undefined {
  const status = mapStatus(assertion.status);
  const meta = replayMetadata(messages, config, budget);

  const properties: Record<string, string> = { file: testFilePath };
  for (const param of meta.caseParameters) {
    properties[param.name] = propertyValue(param.value, param.masked);
  }

  // Jest's ancestorTitles are describe names, not user tags. They are already
  // part of fullName, so they are NOT folded into tags here -- the CLI's own
  // Jest-JSON parser does that, and it is why a Jest launch currently shows
  // describe blocks masquerading as tags.
  const tags = capTags(meta.tags);
  const error = joinFailures(assertion.failureMessages);
  const attempts = buildAttempts(assertion, status);
  const invocations = Math.max(1, assertion.invocations ?? 1);

  // Jest gives console output per FILE, not per test, so this is the file's
  // output -- and attaching it to EVERY case duplicated it N times. A 300-test
  // file logging 16KB produced ~4.8MB of byte-identical text in one report,
  // against /collect's 10MB limit, and unlike attachments it was charged
  // against no budget at all.
  //
  // Attached to failing cases only: that is when captured output is worth
  // reading, and it bounds the duplication to the number of failures rather
  // than the number of tests. The per-file attribution caveat is in
  // LIMITATIONS.md.
  const stdout =
    status === 'failed'
      ? clampOutputLines(consoleLines, MAX_ATTEMPT_OUTPUT_LINES, MAX_ATTEMPT_OUTPUT_RUNES)
      : undefined;

  return {
    // The FILE plus the full name. Jest has no per-test id of its own, and
    // `fullName` alone is just the describe path plus the title — so two files
    // each containing `test('works')` would produce the same id. The server's
    // uniqueness is suite-scoped and this reporter emits one suite per file, so
    // that would not collide today; this does not depend on that holding.
    id: `${testFilePath}#${assertion.fullName}`,
    name: assertion.fullName,
    className: testFilePath,
    status,
    duration: msToNs(assertion.duration ?? 0),
    retryCount: invocations - 1,
    isFlaky: status === 'passed' && invocations > 1,
    ...(attempts ? { attempts } : {}),
    ...(error ? { error } : {}),
    ...(meta.priority ? { priority: meta.priority } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    properties,
    ...(stdout ? { stdout } : {}),
    // Sliced like labels/links/tags. AttachmentBudget bounds the BYTES; nothing
    // bounded the item COUNT, so a loop calling qualflare.attachment() produced
    // an array the server then truncates or rejects.
    ...(meta.attachments.length > 0
      ? { attachments: meta.attachments.slice(0, MAX_ATTACHMENTS_PER_CASE) }
      : {}),
    ...(meta.steps.length > 0 ? { steps: meta.steps } : {}),
    ...(meta.labels.length > 0 ? { labels: meta.labels.slice(0, MAX_LABELS_PER_CASE) } : {}),
    ...(meta.links.length > 0 ? { links: meta.links.slice(0, MAX_LINKS_PER_CASE) } : {}),
  };
}
