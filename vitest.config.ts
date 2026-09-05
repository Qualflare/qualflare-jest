import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  define: {
    // Mirrors tsup.config.ts's `define` — see src/config/version.ts for why
    // this is a build-time constant rather than a runtime read.
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/*.test.ts'],
    // The fixture project's own tests are .test.ts too, and are meant to be run
    // by the child `vitest` process the integration suite spawns — never by
    // this one. Without this they are collected here as well, so the fixtures
    // that fail BY DESIGN (failing, flaky) fail the package's own suite.
    exclude: ['**/node_modules/**', 'test/integration/fixtures/**'],
  },
});
