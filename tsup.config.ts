import { createRequire } from 'node:module';

import { defineConfig } from 'tsup';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  entry: { index: 'src/index.ts', 'reporter/index': 'src/reporter/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  splitting: false,
  shims: false,
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
});
