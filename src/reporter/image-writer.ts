import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { logger } from '../shared/logger.js';

/** Extension -> MIME for the image formats the upload endpoint accepts (see
 * `launch.AllowedAttachmentUploadMimeTypes` server-side). Anything else — a
 * `.bmp`, an `.svg`, a text log — has nowhere to go out of band and keeps the
 * inline path, which is still bounded by `maxAttachmentBytes` and the run
 * budget. */
const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

/** MIME -> extension, for buffers that carry a type but no filename. */
const IMAGE_EXTENSIONS_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
};

export interface ImageWriteResult {
  /** Filename relative to the `outputDir` this was written into — never an
   * absolute path, since the whole directory travels together as one CI
   * artifact bundle. */
  localImagePath: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Whether this MIME type can travel out of band as an image at all.
 *
 * A type predicate rather than a plain boolean, so a caller holding
 * `string | undefined` is narrowed by the check instead of having to assert the
 * type back afterwards.
 */
export function isOffloadableImage(mimeType: string | undefined): mimeType is string {
  return mimeType !== undefined && mimeType in IMAGE_EXTENSIONS_BY_MIME;
}

/**
 * Copies one screenshot into `outputDir` and returns enough to build that
 * `Attachment` entry's `localImagePath`, so an image travels out of band rather
 * than being base64-inlined into the report and from there into the `/collect`
 * body.
 *
 * The MIME type is derived from the EXTENSION, not from any declared
 * `contentType`: the upload endpoint cross-checks the two, so a declared type
 * that disagrees with the file on disk earns a 400 per screenshot.
 *
 * An unsupported extension returns undefined WITHOUT warning. Every non-image
 * attachment reaches this function on its way to the inline path, so warning
 * here would fire on ordinary logs and JSON — it is the normal case, not a
 * fault.
 *
 * Requires `@qualflare/cli` v0.1.24+, which reads `localImagePath`. An older CLI
 * ignores it, leaving an attachment with neither content nor storageKey — a row
 * the server persists from its name alone, showing as an undownloadable
 * placeholder.
 */
export function copyImageAttachment(
  filePath: string,
  outputDir: string,
  maxImageBytes: number,
): ImageWriteResult | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES_BY_EXTENSION[ext];
  if (!mimeType) {
    return undefined;
  }
  // Defensive: outputDir is required by the config type, but a reporter must
  // never throw over an attachment, and without this a missing one is a
  // TypeError out of path.join rather than a skipped offload.
  if (!outputDir) {
    return undefined;
  }

  let fileSize: number;
  try {
    // Stat BEFORE copying — an oversized file must never be copied just to
    // discover it should be skipped.
    fileSize = fs.statSync(filePath).size;
  } catch (err) {
    logger.warn(`skipping image attachment "${filePath}": could not stat file: ${(err as Error).message}`);
    return undefined;
  }
  if (fileSize > maxImageBytes) {
    logger.warn(
      `skipping image attachment "${filePath}": ${fileSize} bytes exceeds the configured ` +
        `maxAttachmentBytes cap of ${maxImageBytes} bytes.`,
    );
    return undefined;
  }

  const localImagePath = `${randomUUID()}${ext}`;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(outputDir, localImagePath));
  } catch (err) {
    logger.warn(`skipping image attachment "${filePath}": could not copy file: ${(err as Error).message}`);
    return undefined;
  }

  return { localImagePath, fileSize, mimeType };
}

/**
 * Writes an in-memory screenshot into `outputDir`.
 *
 * This is the shape both of this reporter's image sources actually produce:
 * `qualflare.attachment()` hands over a Buffer, and a Vitest annotation can
 * carry a `body` rather than a `path`. Refusing it would leave those inline,
 * which is the thing this removes.
 */
export function writeImageAttachment(
  bytes: Buffer,
  mimeType: string,
  outputDir: string,
  maxImageBytes: number,
): ImageWriteResult | undefined {
  const ext = IMAGE_EXTENSIONS_BY_MIME[mimeType];
  if (!ext) {
    return undefined;
  }
  if (!outputDir) {
    return undefined;
  }
  if (bytes.byteLength > maxImageBytes) {
    logger.warn(
      `skipping image attachment: ${bytes.byteLength} bytes exceeds the configured ` +
        `maxAttachmentBytes cap of ${maxImageBytes} bytes.`,
    );
    return undefined;
  }

  const localImagePath = `${randomUUID()}${ext}`;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, localImagePath), bytes);
  } catch (err) {
    logger.warn(`skipping image attachment: could not write file: ${(err as Error).message}`);
    return undefined;
  }
  return { localImagePath, fileSize: bytes.byteLength, mimeType };
}
