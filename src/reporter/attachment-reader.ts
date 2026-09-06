import * as fs from 'node:fs';

import { logger } from '../shared/logger.js';
import type { Attachment } from '../shared/types.js';
import type { ResolvedReporterConfig } from '../config/resolve-config.js';

/**
 * Running total of ENCODED inline attachment bytes for one reporter process, so
 * a single pathological run can't push a launch past the server's body limit.
 * Identical to the class every sibling package uses.
 *
 * Encoded, not raw, because base64 is what actually travels and what the limit
 * is measured against. Counting raw bytes made the cap mean 4/3 more than it
 * said: a fully-used 10,000,000-byte budget is 13,333,336 bytes of `content`,
 * which is 1.27x `/collect`'s BodyLimit(10<<20) = 10,485,760. See
 * `base64Length`.
 */
/**
 * Length of `Buffer.toString("base64")` without producing it.
 *
 * base64 emits 4 characters per 3 input bytes, padded up. Computed arithmetically
 * so the budget can be checked BEFORE a large buffer is encoded, rather than
 * allocating the string only to discard it.
 */
export function base64Length(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

export class AttachmentBudget {
  private used = 0;

  constructor(private readonly maxTotalBytes: number) {}

  tryReserve(bytes: number): boolean {
    if (this.used + bytes > this.maxTotalBytes) {
      return false;
    }
    this.used += bytes;
    return true;
  }

  /** Returns bytes to the budget when an attachment they were reserved for
   * is discarded. Nothing in THIS reporter calls it: Jest reports each test
   * once, already finished, so there is no superseded attempt to unwind. Kept
   * because the budget is shared verbatim with the sibling packages, where a
   * retried test's discarded attempt does need it. */
  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }

  get usedBytes(): number {
    return this.used;
  }
}

/**
 * Turns raw bytes into a wire `Attachment`, enforcing BOTH caps.
 *
 * Every path that inlines content must go through here. `/collect` rejects a
 * body over 10MB outright (api-service `launch_controller.go`'s
 * `BodyLimit(10<<20)`), and a rejected request loses the ENTIRE launch — not
 * just the oversized attachment, so a path that skips the budget can silently
 * destroy a whole run's results.
 *
 * The budget is spent in ENCODED bytes, because base64 is what the body limit
 * measures. A raw-byte budget understated the cost by 4/3.
 *
 * The budget covers a smaller population than it used to. Screenshots no longer
 * inline at all — they are written into `outputDir` and referenced by
 * `localImagePath` (see `image-writer.ts`), so they are not in the request body
 * and do not draw on this. What remains here is text: logs, JSON, markdown.
 */
export function inlineFromBuffer(
  name: string,
  bytes: Buffer,
  mimeType: string | undefined,
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): Attachment | undefined {
  if (bytes.byteLength > config.maxAttachmentBytes) {
    logger.warn(
      `skipping attachment "${name}": ${bytes.byteLength} bytes exceeds the configured maxAttachmentBytes cap of ${config.maxAttachmentBytes} bytes.`,
    );
    return undefined;
  }
  const encoded = base64Length(bytes.byteLength);
  if (!budget.tryReserve(encoded)) {
    logger.warn(
      `skipping attachment "${name}": this run's total inline-attachment budget of ${config.maxTotalAttachmentBytes} encoded bytes is exhausted ` +
        `(this one needs ${encoded}, being ${bytes.byteLength} raw bytes as base64).`,
    );
    return undefined;
  }

  return {
    name,
    ...(mimeType ? { mimeType } : {}),
    content: bytes.toString('base64'),
    fileSize: bytes.byteLength,
  };
}

/**
 * Reads a file from disk and inlines it, subject to the same caps.
 *
 * `stat`s before reading so an oversized file is rejected without ever being
 * pulled into memory. Every failure warns and returns `undefined`; an
 * attachment must never fail a run.
 */
export function inlineFromFile(
  name: string,
  filePath: string,
  mimeType: string | undefined,
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): Attachment | undefined {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    logger.warn(`skipping attachment "${name}": could not stat ${filePath}: ${(err as Error).message}`);
    return undefined;
  }
  if (size > config.maxAttachmentBytes) {
    logger.warn(
      `skipping attachment "${name}": ${size} bytes exceeds the configured maxAttachmentBytes cap of ${config.maxAttachmentBytes} bytes.`,
    );
    return undefined;
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    logger.warn(`skipping attachment "${name}": could not read ${filePath}: ${(err as Error).message}`);
    return undefined;
  }
  return inlineFromBuffer(name, bytes, mimeType, config, budget);
}
