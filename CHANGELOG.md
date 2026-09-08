# Changelog

## 0.1.2

Package metadata only — no code change, and nothing to do if you are already on
0.1.1.

`keywords` now matches the rest of the reporter family: `flaky-tests` and
`test-reporter` added, the bare `reporter` dropped. The eight Qualflare
reporters had drifted into two different keyword conventions, so a search that
found one would miss the others.

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.1

### Fixed

- **`maxTotalAttachmentBytes` is charged in encoded bytes, not raw.** An attachment contributes its
  base64 to the report, which is 4/3 larger than the source, so the cap admitted a third more than it
  said: a fully-spent 10,000,000-byte budget produced 13,333,336 bytes of content against
  `/collect`'s 10,485,760-byte body limit. The configured number now means what it says. Set it from
  the raw size you expect and it will no longer overshoot; a run that was quietly near the limit may
  now warn and skip an attachment it previously included.
  `maxAttachmentBytes` is unchanged and still measures the source file.

### Changed

- The npm `homepage` now points at this reporter's own documentation page rather than the Qualflare
  site root, so the package page links somewhere with install and configuration instructions.

## 0.1.0

Initial release.

### Added

- A native Jest reporter that writes a Qualflare Collect report straight from a `jest` run: status,
  per-attempt retry history, flakiness, nested steps, attachments and the author-facing metadata API
  (labels, links, tags, priority, description, parameters).
- Per-attempt history read directly from Jest's `AssertionResult.invocations` and `.retryReasons`,
  rather than reconstructed. See "Known limitations" for the `logErrorsBeforeRetry` caveat.
- Image attachments written into `outputDir` and referenced by `localImagePath`, so they never
  travel base64-inlined inside the `/collect` request body. Requires `@qualflare/cli` v0.1.24+.
- A metadata side-channel that carries `qualflare.*()` calls from Jest's test workers to the
  reporter in the main process, with no change to the user's `testEnvironment`.

### Notes

- The reporter makes **no network calls**. It writes a report directory that
  [`qualflare-cli`](https://github.com/Qualflare/qualflare-cli) uploads, which is what lets any
  number of sharded CI jobs merge into a single Launch.
- Requires `jest >= 29.0.0`. Tested against 29.7.0, 30.0.5 and 30.5.1.
