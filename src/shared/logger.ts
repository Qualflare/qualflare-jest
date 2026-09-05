/**
 * A minimal logger that genuinely writes to stderr.
 *
 * Two reasons it bypasses `console` entirely rather than using
 * `console.log`/`console.warn`:
 *
 * 1. **stdout is Jest's own machine-readable channel.** `jest --json` writes
 *    the run's report there, so a diagnostic line on stdout corrupts anything
 *    parsing it. The previous version claimed to avoid stdout in its header
 *    and then used `console.log` for `info` — including the one line printed on
 *    every successful run.
 *
 * 2. **Inside a Jest worker, `console` is not Node's.** Jest replaces it with
 *    a `BufferedConsole` whose output is collected into `TestResult.console`
 *    and handed to reporters. Since this module is also called from the worker
 *    side (`runtime/channel.ts`, `runtime/qualflare-api.ts`), routing through
 *    `console` would fold the reporter's own warnings into the user's captured
 *    test output — which this reporter then attaches to every case in the file.
 *    Writing to the stream directly keeps our diagnostics out of their report.
 */

const PREFIX = '[qualflare-jest]';

function write(stream: NodeJS.WriteStream, args: unknown[]): void {
  try {
    const text = args
      .map((a) => (typeof a === 'string' ? a : String(a instanceof Error ? a.message : a)))
      .join(' ');
    stream.write(`${PREFIX} ${text}\n`);
  } catch {
    // A logger must never be the reason a run fails.
  }
}

export const logger = {
  debug(...args: unknown[]): void {
    write(process.stderr, args);
  },
  info(...args: unknown[]): void {
    write(process.stderr, args);
  },
  warn(...args: unknown[]): void {
    write(process.stderr, args);
  },
  error(...args: unknown[]): void {
    write(process.stderr, args);
  },
};
