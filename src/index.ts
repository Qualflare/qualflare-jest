import type { QualflareJestOptions } from './config/resolve-config.js';

export { qualflare } from './runtime/qualflare-api.js';

export type { QualflareJestOptions, ResolvedReporterConfig } from './config/resolve-config.js';

export type {
  Attachment,
  Case,
  CasePriority,
  CaseStatus,
  Collect,
  FrameworkCategory,
  Label,
  Link,
  LinkType,
  Metadata,
  NanosecondDuration,
  Parameter,
  Platform,
  Step,
  Suite,
} from './shared/types.js';

/** The tuple form Jest accepts in `reporters`: a module specifier and
 * its options. Jest types this as `[ReporterName, Record<string, unknown>]`,
 * where the options are unchecked. */
export type QualflareReporterDescription = ['@qualflare/jest/reporter', QualflareJestOptions];

/**
 * Typed helper for registering the reporter.
 *
 * Jest types a custom reporter's options as `Record<string, unknown>`, so
 * writing the tuple by hand gives no autocomplete and silently accepts typos.
 * This returns the same tuple with the options checked:
 *
 * ```ts
 * import { qualflareReporter } from '@qualflare/jest';
 *
 * export default {
 *   reporters: ['default', qualflareReporter({ environment: 'staging' })],
 * };
 * ```
 *
 * Or without the helper, in `jest.config.js`:
 *
 * ```js
 * reporters: ['default', ['@qualflare/jest/reporter', { environment: 'staging' }]]
 * ```
 */
export function qualflareReporter(options: QualflareJestOptions = {}): QualflareReporterDescription {
  return ['@qualflare/jest/reporter', options];
}
