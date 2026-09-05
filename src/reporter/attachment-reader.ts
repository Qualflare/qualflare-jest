import * as fs from 'node:fs';

import { logger } from '../shared/logger.js';
import type { Attachment } from '../shared/types.js';
import type { ResolvedReporterConfig } from '../config/resolve-config.js';

/** Running total of inline attachment bytes for one reporter process, so a
 * single pathological run can't push a launch past the server's body limit.
 * Identical to the class every sibling package uses. */
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
  if (!budget.tryReserve(bytes.byteLength)) {
    logger.warn(
      `skipping attachment "${name}": this run's total inline-attachment budget of ${config.maxTotalAttachmentBytes} bytes is exhausted.`,
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
