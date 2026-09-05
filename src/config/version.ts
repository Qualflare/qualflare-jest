// `__PACKAGE_VERSION__` is injected at build time by tsup's `define` option
// (see tsup.config.ts) from package.json's `version` field. Deliberately
// NOT read at runtime via `import.meta.url` + `createRequire` — that breaks
// the CJS build output (`import.meta` is empty/unavailable once esbuild
// compiles to CommonJS), which is exactly the class of dual-CJS/ESM-package
// bug a build-time constant sidesteps entirely. Under Vitest (which never
// goes through tsup), `vitest.config.ts` defines the same constant so this
// module behaves identically in tests and in the built package.
declare const __PACKAGE_VERSION__: string;

export const PACKAGE_VERSION: string = __PACKAGE_VERSION__;
