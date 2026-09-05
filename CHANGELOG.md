# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
