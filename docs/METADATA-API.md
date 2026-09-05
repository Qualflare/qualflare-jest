# Metadata API

`qualflare` is the author-facing runtime API — the thing Jest's own JSON output has no equivalent
of, and the main reason this package exists rather than parsing that file.

```ts
import { expect, test } from 'jest';
import { qualflare } from '@qualflare/jest';
```

Every call attaches to the **currently running test**, wherever it is made: the test body, a
`beforeEach`, or a helper several frames deep. Calling one outside a running test (at module load,
from `globalSetup`, or after a test has finished) logs a warning and is ignored — a metadata call
must never fail somebody's suite.

## How it works

Jest runs your tests in **worker processes** and runs reporters in the **main** process, with no
built-in per-test channel between them — there is no equivalent of Vitest's `task.meta`.

Rather than take over your `testEnvironment` (the approach Allure's Jest integration uses, which is
why it ships separate `/node` and `/jsdom` builds), this package stays a single `reporters:` entry
and bridges the gap itself: each `qualflare.*()` call is appended to a small newline-delimited file
in a private temp directory, and the reporter reads them back when the run ends. The directory is
created by the reporter and handed to workers through an environment variable they inherit, so there
is nothing to configure and nothing predictable to collide with.

Three consequences worth knowing:

- Anything you pass must survive JSON — the channel crosses a process boundary, so unserialisable
  values are lost rather than rejected.
- A call made **outside a running test** (`beforeAll`, `afterAll`, module scope) has no test to
  attach to. It is dropped with a warning rather than attributed to whichever test reports first.
- A masked parameter is redacted **before** anything is written, so the real value never reaches the
  temp file, the report, or the server.

Every call is fail-open: a metadata problem never fails your test run.

## `qualflare.label(name, value)`

Arbitrary name/value metadata. This is how Allure-style `epic`/`feature`/`story`/`owner`/`severity`
are expressed.

```ts
qualflare.label('epic', 'Billing');
qualflare.label('owner', 'payments-team');
```

Capped at 100 labels per case (the server's limit); further labels are dropped.

**Requires `@qualflare/cli >= v0.1.18`.** Earlier CLI versions parsed the report but silently
discarded `labels` and `links`, so they never reached the server.

## `qualflare.link(url, opts?)`

A typed external reference.

```ts
qualflare.link('https://tracker.example/QF-42', { type: 'issue', name: 'QF-42' });
qualflare.link('https://wiki.example/runbook');            // type defaults to 'custom'
```

`opts.type` is `'issue' | 'tms' | 'custom'`. Capped at 20 links per case.

## `qualflare.tag(...tags)`

```ts
qualflare.tag('smoke');
qualflare.tag('billing', 'regression');
```

Merged with Jest's own `TestCase.tags`. Use this for tags computed at runtime; declare static ones
in the test signature. Capped at 64 tags per case, each truncated to 255 characters.

## `qualflare.description(text)`

```ts
qualflare.description('Signs a user in and asserts the greeting renders.');
```

Markdown. Last call wins within a test.

## `qualflare.priority(value)`

```ts
qualflare.priority('high');
```

One of `'low' | 'medium' | 'high' | 'critical'`. Last call wins.

## `qualflare.parameter(name, value?, opts?)`

Records a named input.

```ts
qualflare.parameter('sku', 'BOOK-1');
qualflare.parameter('password', secret, { masked: true });
```

**Placement matters.** Inside an open `qualflare.step()`, the parameter attaches to that step.
Outside any step it becomes a `Case.properties` entry instead, because the wire contract has no
case-level `Parameter[]`.

`masked` **redacts the value before the report is written.** The secret never leaves this process:
it is not stored server-side and cannot be read back through the API. Inside a step the parameter
travels as `{ name, masked: true }` with no value and the UI renders `••••••` from the flag; outside
one it lands in `Case.properties`, a flat map with nowhere for the flag, so the value itself becomes
`••••••`.

A masked value is therefore **unrecoverable** — that is the point, but it is not a display toggle you
can undo later.

Requires v0.3.0 or newer of this package. Before that, `masked` was a display hint only: the real value
was sent, stored in plaintext and readable through the API, while only the UI drew dots over it.

## `qualflare.attachment(name, content, opts?)`

Attach in-memory content.

```ts
qualflare.attachment('request', JSON.stringify(body), { mimeType: 'application/json' });
qualflare.attachment('thumbnail', pngBase64, { encoding: 'base64', mimeType: 'image/png' });
```

`opts.encoding` is `'utf8'` (default) or `'base64'`. Subject to the same size caps as any other
inline attachment — see [`CONFIGURATION.md`](./CONFIGURATION.md).

## `qualflare.attachmentFromFile(name, path, opts?)`

Attach a file from disk, read at report time.

```ts
qualflare.attachmentFromFile('har', 'artifacts/session.har', { mimeType: 'application/json' });
```

An unreadable path is skipped with a warning rather than failing the test.

## `qualflare.step(name, fn)`

Records a named step around `fn`, capturing its duration and whether it threw.

```ts
await qualflare.step('add an item to the cart', async () => {
  qualflare.parameter('sku', 'BOOK-1');
  expect(cart.items).toHaveLength(1);
});
```

Always `await` it — it returns a promise resolving to whatever `fn` returns, and a rejection is
re-thrown after the failure is recorded, so control flow is unchanged.

**Jest has no `test.step()`**, so this is the only way to get step structure into a report — and
the step exists in Qualflare only, not in Jest's terminal or HTML output. The sibling Playwright
package does delegate to a native step API, so its steps appear in both.

Timing is exact: real elapsed time around the awaited body, not an approximation.

Steps nest, and nesting is preserved in the report via `parentIndex`. A single test may record at
most 300 steps; past that they are dropped with a warning rather than risking the server rejecting
the whole case.

## Jest has no native attachment API

Playwright, Cypress and CucumberJS each capture something automatically — screenshots, videos, or
`this.attach()` calls. Jest has no equivalent: it produces no artifacts of its own, so
`qualflare.attachment()` and `qualflare.attachmentFromFile()` are the only way to attach anything.

Images (`image/png`, `image/jpeg`, `image/gif`) are written into `outputDir` and referenced by
`localImagePath`, so they never travel base64-inlined inside the upload body. Everything else is
inlined, bounded by `maxAttachmentBytes` and the run-wide budget.
