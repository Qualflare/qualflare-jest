// Retries are scoped to THIS FILE via jest.retryTimes, which is per-file in
// Jest. The suite sets no global retry: a global one would re-run a genuine
// regression and quietly turn it green, in a suite whose whole job is that red
// means something.
//
// logErrorsBeforeRetry is on deliberately -- it is what makes Jest supply the
// per-attempt error text, and this suite exists partly to prove that path.
jest.retryTimes(1, { logErrorsBeforeRetry: true });

// A module-level counter, because Jest exposes no attempt index to a test.
// Deliberately NOT a marker file on disk: that survives an interrupted run and
// silently makes the next run's first attempt pass, turning this into a no-op
// that still looks green.
let attempts = 0;

test('fails once, then passes, producing per-attempt history', () => {
  attempts += 1;
  if (attempts === 1) {
    // Thrown rather than asserted: Jest's expect() takes no message argument
    // (that is Vitest's signature), and naming the marker in the error is what
    // makes the first attempt's recorded message self-explaining in the UI.
    throw new Error('dogfood-intentional-retry-marker');
  }
  expect(attempts).toBeGreaterThan(1);
});
