# @qualflare/jest

[![npm version](https://img.shields.io/npm/v/%40qualflare%2Fjest.svg)](https://www.npmjs.com/package/@qualflare/jest)
[![CI](https://github.com/Qualflare/qualflare-jest/actions/workflows/ci.yml/badge.svg)](https://github.com/Qualflare/qualflare-jest/actions/workflows/ci.yml)
[![Qualflare](https://api.qualflare.com/p/qualflare-jest/badge.svg)](https://reports.qualflare.com/p/qualflare-jest/launches)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

A native Jest reporter for [Qualflare](https://qualflare.com) — captures test results directly from
your `jest` run: status, per-attempt retry history and flakiness, nested steps, attachments, and
author-facing metadata (labels, links, tags, priority, custom parameters).

Without it, Jest results reach Qualflare through the Jest JSON file, which carries pass/fail and
duration and nothing else — no retries, no flakiness, no attachments, no metadata.

The reporter itself makes **no network calls**. It writes a report directory, and
[`qualflare-cli`](https://github.com/Qualflare/qualflare-cli) uploads it — which is what lets any
number of sharded CI jobs merge into a single Launch.

## Install

```bash
npm install --save-dev @qualflare/jest
```

Requires `jest` `>=29.0.0` (installed separately as a peer dependency) and Node `>=18`. You also need
[`@qualflare/cli`](https://github.com/Qualflare/qualflare-cli) **v0.1.24 or newer** — that is the
first release that reads `localImagePath`, and on an older CLI image attachments are recorded from
their name alone as undownloadable placeholders.

## Quickstart

```js
// jest.config.js
module.exports = {
  reporters: ['default', ['@qualflare/jest/reporter', { environment: 'staging' }]],
};
```

Or with the typed helper, which checks the options for you:

```js
const { qualflareReporter } = require('@qualflare/jest');

module.exports = {
  reporters: ['default', qualflareReporter({ environment: 'staging' })],
};
```

Then run your tests and upload:

```bash
npx jest
npm install -g @qualflare/cli
qf login my-project "$QUALFLARE_TOKEN" --force
qf my-project collect ./qualflare-results
```

Nothing else changes. Your `testEnvironment` is untouched — see
[`docs/LIMITATIONS.md`](./docs/LIMITATIONS.md) for how metadata reaches the reporter without it.

### Sharded CI

Point every shard at the **same** `outputDir` and collect once at the end. Each process writes its
own uniquely-named file, so shards never overwrite each other, and `qf collect` merges every file in
the directory into a single Launch.

## Enriching your tests

```js
const { qualflare } = require('@qualflare/jest');

test('checks out', async () => {
  qualflare.label('feature', 'checkout');
  qualflare.link('https://example.com/issue/42', { type: 'issue', name: 'QF-42' });
  qualflare.tag('smoke');
  qualflare.priority('high');

  await qualflare.step('add to cart', () => {
    qualflare.parameter('sku', 'widget');
    qualflare.parameter('token', process.env.TOKEN, { masked: true });
  });
});
```

Full reference in [`docs/METADATA-API.md`](./docs/METADATA-API.md).

## Configuration

Every option and environment variable is in [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md).

## Test reports

This reporter is tested with itself. `e2e/` is a Jest suite covering this package's own behaviour —
the metadata API, nested steps, image attachments and per-attempt retry history — run by this
reporter and uploaded to Qualflare on every merge to `main`. The results below are that suite's,
reported through the code this README documents:

[![Qualflare](https://api.qualflare.com/p/qualflare-jest/banner.svg)](https://reports.qualflare.com/p/qualflare-jest/launches)

Every case there is meant to pass, so a red run is a real regression rather than a fixture that fails
on purpose. Deliberately-failing cases live in `test/integration/`, which is never uploaded.

## Known limitations

- **Per-attempt error messages need `logErrorsBeforeRetry`.** Jest reports how many times a test ran
  (`invocations`) unconditionally, so the attempt structure is always recorded — but it only supplies
  the error from each failed attempt when you opt in with
  `jest.retryTimes(n, { logErrorsBeforeRetry: true })`. Without it you get the attempts and their
  statuses, with no messages.
- **Captured output is per file, not per test.** Jest hands reporters one console buffer per test
  file, so a case's `stdout` is its file's output rather than its own.
- **Metadata outside a running test is dropped.** A `qualflare.*()` call in `beforeAll`, `afterAll`
  or at module scope has no test to attach to and is discarded with a warning, rather than being
  attributed to whichever test happens to report first.

Full details in [`docs/LIMITATIONS.md`](./docs/LIMITATIONS.md).

## Development

```bash
npm ci
npm run build
npm test              # unit
npm run test:integration   # spawns a real jest run against test/integration/fixtures
npm run e2e           # the dogfood suite, then verifies the report it wrote
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
