// The reporter is loaded from the BUILT dist/, not src/, so the integration
// suite exercises what actually ships — a broken exports map or a build that
// drops a file fails here rather than after publishing.
export default {
  rootDir: '.',
  testEnvironment: 'node',
  reporters: [
    'default',
    [
      new URL('../../../../dist/reporter/index.cjs', import.meta.url).pathname,
      { outputDir: process.env.QF_OUT ?? './qualflare-results', environment: 'staging' },
    ],
  ],
  // One retry, so the flaky fixture can pass on its second attempt and prove
  // invocations/retryReasons become attempts[].
  testRunner: 'jest-circus/runner',
};
