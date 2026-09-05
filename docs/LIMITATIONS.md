# Known limitations

What this reporter does not do, and why. Everything here is deliberate; where a limitation comes
from Jest rather than from this package, that is said plainly.

## Per-attempt error messages need `logErrorsBeforeRetry`

Jest reports how many times a test ran through `AssertionResult.invocations`, unconditionally. So
`retryCount`, `isFlaky` and the shape of `attempts[]` — how many attempts there were and which one
passed — are always recorded.

The **error from each failed attempt** is a separate matter. It arrives in
`AssertionResult.retryReasons`, and Jest only populates that when you opt in:

```js
jest.retryTimes(2, { logErrorsBeforeRetry: true });
```

Without it, `retryReasons` comes back empty — measured against Jest 30.5.1, not inferred from the
type, which marks the field optional and says nothing about when it is filled. The reporter still
records the attempts and their statuses, because knowing a test failed twice before passing is worth
having on its own, and logs a one-line hint the first time it sees the situation.

This is the one place a sibling reporter does better by default: `@qualflare/vitest` reconstructs
per-attempt errors from Vitest's accumulated error list, which needs no opt-in.

## Captured output is per file, not per test

Jest hands reporters one console buffer per test **file** (`TestResult.console`), with no reliable
attribution to individual tests. So a case's `stdout` is the output of the file it lives in, not of
that test specifically.

Because of that, it is attached to **failing cases only**. Attaching a file's buffer to every case
duplicated it once per test: a 300-test file logging 16KB produced roughly 4.8MB of byte-identical
text in a single report, against `/collect`'s 10MB body limit — and unlike attachments, output is
charged against no budget. Failures are where captured output is worth reading, and the duplication
is then bounded by the number of failures rather than the number of tests.

The sibling reporters do not have this caveat, because their frameworks scope captured output to the
test. Nothing here can narrow it without parsing console origins, which would be guesswork.

## Metadata outside a running test is dropped

`qualflare.*()` resolves the current test through `expect.getState()`, which returns no
`currentTestName` outside a test body. A call in `beforeAll`, `afterAll` or at module scope
therefore has nothing to attach to.

Those calls are discarded with a warning — once per test file, which names every file with the
problem rather than only the first — rather than attached to whichever test reports
first. Attributing them by proximity is a misattribution bug the Cypress plugin already had to fix
once, and silent wrong data is worse than absent data.

## Two tests with the same full name in one file share metadata

Metadata is keyed on the test's full name plus its file path — the pair Jest reports back. Two tests
in the same file with an identical `describe` path *and* title cannot be told apart, so their
metadata merges.

`test.each` is unaffected in practice: its names are templated from the row data and differ. This
only bites on literal duplicates, which are a lint smell in their own right.

## Metadata from an abandoned retry is discarded, not merged

When a test is retried, each attempt emits its own metadata. The reporter keeps the **final**
attempt's and discards the rest, matching the rule the sibling reporters document: steps, labels and
attachments describe the attempt that decided the outcome.

`attempts[]` still records every attempt's status, so nothing about the retry history is lost — only
the metadata of attempts that were superseded.

## A suite that mocks `fs` still works, but the channel is what makes it possible

`jest.mock('fs')` replaces the module inside the sandbox. This reporter writes its metadata channel
through `jest.requireActual('node:fs')` specifically so those writes neither disappear into your
mock nor show up in your assertions — an `expect(fs.appendFileSync).not.toHaveBeenCalled()` must keep
passing with this package installed.

If the real module ever cannot be reached, the reporter stops writing rather than write through a
mock. You lose the metadata for that file; your suite keeps passing.

## Artifacts are written, not uploaded

Image attachments are written into `outputDir` and referenced by `localImagePath`;
`qualflare-cli` uploads them at collect time and resolves each into a real `storageKey`. This
reporter never makes a network call.

**Needs `@qualflare/cli` v0.1.24+.** An older CLI does not read the field, and because such an
attachment carries neither content nor a storage key the server records it from its name alone — an
undownloadable placeholder. This is not something the reporter can detect for you.

## Steps exist only in Qualflare

`qualflare.step()` records a step in the report. Jest has no step concept of its own, so steps do not
appear in Jest's own output, and a failing step surfaces as a failing test.

Nesting is preserved via `parentIndex`, and steps are capped at 300 per attempt — well under the
server's 1000-per-case limit — with anything beyond dropped and a warning logged.

## `parameter()` masking redacts the value

`qualflare.parameter(name, value, { masked: true })` sends the name and a masked marker, never the
value. This is not a display hint: the value is dropped **in the worker**, before anything is
serialized, so it never reaches the channel file on disk, the report, or the server.

That ordering matters more here than in the sibling reporters, whose channel is memory. Here it is a
file, so masking after the fact would already have written the secret.

## Sharded CI: point every shard at the same `outputDir`

Each Jest process writes one uniquely-named report, so shards never overwrite each other. Collect the
directory once at the end and `qf collect` merges every file into a single Launch.

## Not limitations of this reporter

- **No `timeout` or `aborted` status.** Jest has no distinct timed-out state — a timeout surfaces as
  a failure carrying a timeout message — so those two wire statuses are never produced.
- **`todo` and `skipped` both map to `skipped`.** They mean the same thing to a report: the test did
  not execute.
- **No video.** Jest records none.
- **`describe` names are not tags.** They are already part of the test's full name. The CLI's own
  Jest-JSON parser folds them into `tags`, which is why a Jest launch collected that way shows
  describe blocks masquerading as tags; this reporter does not.
