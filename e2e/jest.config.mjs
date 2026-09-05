// The dogfood suite: qualflare-jest reporting on tests of itself.
//
// Unlike test/integration/fixtures/jest-project, every test here is meant to
// PASS. That fixture deliberately fails, to exercise status mapping; this one is
// uploaded to Qualflare, so red has to mean a real regression rather than
// expected fixture noise. Status mapping stays the fixture's job — please do not
// add a failing test here.
//
// The reporter is loaded from BUILT dist/, so `npm run build` is a prerequisite
// and the suite exercises what actually ships.
export default {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/tests/**/*.e2e.js'],
  reporters: [
    'default',
    [
      '<rootDir>/dist/reporter/index.cjs',
      {
        // Relative to rootDir, which is the repo root.
        outputDir: process.env.QUALFLARE_OUTPUT_DIR ?? './e2e-results',
        // Recorded in the report itself rather than passed at collect time, so
        // there is one source of truth for the environment.
        environment: 'production',
        branch: null,
        commit: null,
      },
    ],
  ],
};
