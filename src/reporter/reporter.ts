import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { resolveConfig, type QualflareJestOptions, type ResolvedReporterConfig } from '../config/resolve-config.js';
import { CHANNEL_DIR_PREFIX } from '../shared/constants.js';
import { logger } from '../shared/logger.js';

import { CHANNEL_ENV_VAR, collapseByCase, drain, segmentKey } from '../runtime/channel.js';
import { AttachmentBudget } from './attachment-reader.js';
import { buildCase } from './case-builder.js';
import { buildCollectPayload } from './collect-builder.js';
import { groupIntoSuites, relativizeFile, type CaseWithFile } from './suite-builder.js';

/**
 * Minimal structural types for the Jest reporter surface.
 *
 * Declared here rather than imported from `@jest/reporters` so the published
 * package carries no runtime dependency on Jest's internals and works across
 * the whole supported range (>=29). Every field used is present in 29.7 and on
 * main; `invocations` and `retryReasons` were verified in both.
 */
interface JestTest {
  path: string;
}

export interface JestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  title: string;
  status: string;
  duration?: number | null;
  failureMessages: string[];
  location?: { line: number; column: number } | null;
  /** Total executions of this test: 1 plus the number of retries. */
  invocations?: number;
  /** The errors from the attempts that failed. Present from Jest 29. */
  retryReasons?: string[];
}

interface JestTestResult {
  testFilePath: string;
  testResults: JestAssertionResult[];
  console?: Array<{ type: string; message: string }>;
}

/**
 * Writes ONE uniquely-named JSON report per process into `outputDir` and makes
 * zero network calls. `qualflare-cli collect <outputDir>` uploads the result —
 * which is what lets any number of sharded CI jobs merge into a single Launch.
 *
 * Registered in `jest.config`:
 *
 *     reporters: ['default', ['@qualflare/jest/reporter', { environment: 'staging' }]]
 */
export default class QualflareReporter {
  private readonly options: QualflareJestOptions;
  private config: ResolvedReporterConfig;
  private budget: AttachmentBudget;
  private rootDir = process.cwd();
  private readonly channelDir: string;
  private readonly consoleByFile = new Map<string, string[]>();
  private readonly exitCleanup = (): void => this.cleanupChannel();

  constructor(globalConfig?: { rootDir?: string }, options: QualflareJestOptions = {}) {
    this.options = options;
    this.rootDir = globalConfig?.rootDir || process.cwd();
    this.config = resolveConfig(this.options, {});
    // Resolve outputDir ONCE so every consumer sees the same absolute path.
    // Resolving again at a use site is what let the report and its screenshots
    // land in different directories in two sibling reporters -- the report was
    // written relative to the project root and the images relative to the CWD,
    // leaving localImagePath pointing at a file the CLI could not find.
    this.config.outputDir = this.resolveOutputDir(this.config.outputDir);
    this.budget = new AttachmentBudget(this.config.maxTotalAttachmentBytes);

    // The metadata side-channel. Created HERE, in the constructor, because Jest
    // builds its worker pool only after every reporter is constructed -- so an
    // env var set now is inherited by every forked worker. See channel.ts.
    // pid AND uuid: the uuid keeps the path unpredictable (nothing can squat
    // it, and concurrent runs cannot collide), while the pid makes a leftover
    // directory attributable to a process whose liveness can be checked. A
    // uuid alone would force the sweep to fall back on age, leaving a day of
    // litter behind every interrupted run.
    this.channelDir = path.join(os.tmpdir(), `${CHANNEL_DIR_PREFIX}${process.pid}-${randomUUID()}`);
    this.guard('setup', () => {
      this.sweepStaleChannels();
      fs.mkdirSync(this.channelDir, { recursive: true, mode: 0o700 });
      process.env[CHANNEL_ENV_VAR] = this.channelDir;
      // Jest does not always reach onRunComplete -- Ctrl-C, a fatal config
      // error, a crashed main process. Without this the session directory
      // survives until the next run's sweep notices it, which is a day of
      // litter in the user's temp directory for every interrupted run.
      // Removed again in cleanupChannel so watch mode cannot accumulate
      // listeners across runs.
      process.once('exit', this.exitCleanup);
    });
  }

  /** Jest calls this after each test FILE finishes. Every worker write for that
   * file has completed by then, because the worker sends its result only after
   * the test body returns. */
  onTestFileResult(test: JestTest, testResult: JestTestResult): void {
    this.guard('onTestFileResult', () => {
      if (testResult.console && testResult.console.length > 0) {
        this.consoleByFile.set(
          testResult.testFilePath,
          testResult.console.map((entry) => entry.message),
        );
      }
      // Cases themselves are built in onRunComplete, once the whole channel is
      // readable: a worker that crashed mid-file may still have flushed
      // messages worth keeping.
    });
  }

  onRunComplete(_contexts?: unknown, results?: { testResults?: JestTestResult[] }): void {
    this.guard('onRunComplete', () => {
      try {
        this.writeReport(results?.testResults ?? []);
      } finally {
        // Always clean up, even if the report failed to write.
        this.cleanupChannel();
      }
    });
  }

  /**
   * Never reports a metadata failure to Jest.
   *
   * Returning an Error here makes Jest exit non-zero. A reporting problem must
   * never fail somebody's test run -- the method's existence invites the
   * opposite, which is why this is explicit rather than simply omitted.
   */
  getLastError(): undefined {
    return undefined;
  }

  private writeReport(testResults: JestTestResult[]): void {
    const segments = drain(this.channelDir);
    const metadataByCase = collapseByCase(segments);

    const cases: CaseWithFile[] = [];
    for (const fileResult of testResults) {
      const relativeFile = relativizeFile(fileResult.testFilePath, this.rootDir);
      for (const assertion of fileResult.testResults) {
        const built = buildCase(
          assertion,
          relativeFile,
          metadataByCase.get(segmentKey(fileResult.testFilePath, assertion.fullName)) ?? [],
          this.consoleByFile.get(fileResult.testFilePath) ?? [],
          this.config,
          this.budget,
        );
        if (built) {
          cases.push({ file: relativeFile, testCase: built });
        }
      }
    }

    const suites = groupIntoSuites(cases);
    const collect = buildCollectPayload(suites, this.config);

    const outputDir = this.config.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${randomUUID()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(collect));
    logger.info(
      `wrote Collect payload to ${outputPath} — run \`qualflare-cli collect ${outputDir}\` to upload it.`,
    );
  }

  /** Relative `outputDir` resolves against Jest's `rootDir`, not the shell's
   * cwd — a user running `jest` from a monorepo root should still write next to
   * their config.
   *
   * Called exactly once, from the constructor, so `config.outputDir` is
   * absolute everywhere downstream. Do not resolve again at a use site. */
  private resolveOutputDir(outputDir: string): string {
    return path.isAbsolute(outputDir) ? outputDir : path.resolve(this.rootDir, outputDir);
  }

  private cleanupChannel(): void {
    process.removeListener('exit', this.exitCleanup);
    try {
      fs.rmSync(this.channelDir, { recursive: true, force: true });
    } catch {
      // A leftover directory is swept by the next run's stale sweep.
    }
    delete process.env[CHANNEL_ENV_VAR];
  }

  /**
   * Removes channel directories left behind by runs that were killed.
   *
   * Jest does not always reach `onRunComplete`, and a SIGINT'd run does not
   * reliably run `exit` listeners either — measured, not assumed. So the next
   * run collects the remains: each directory carries the pid that made it, and
   * a pid that no longer exists cannot still be writing.
   *
   * Session directories are randomly named and their path lives only in the
   * owning run's environment, so a leftover is unreachable rather than
   * dangerous. This is hygiene, not correctness.
   */
  private sweepStaleChannels(): void {
    const tmp = os.tmpdir();
    let entries: string[];
    try {
      entries = fs.readdirSync(tmp).filter((d) => d.startsWith(CHANNEL_DIR_PREFIX));
    } catch {
      return;
    }
    for (const entry of entries) {
      const pid = Number(entry.slice(CHANNEL_DIR_PREFIX.length).split('-')[0]);
      if (!Number.isInteger(pid) || pid === process.pid) {
        continue;
      }
      try {
        // Signal 0 tests for existence without actually signalling.
        process.kill(pid, 0);
        continue; // Still running: another Jest run owns this one.
      } catch {
        // No such process — safe to remove.
      }
      try {
        fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
      } catch {
        // Another run may have swept it first. Harmless.
      }
    }
  }

  /** Every hook body runs through here: a reporter must never be the reason a
   * test run fails. */
  private guard(hook: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logger.warn(`${hook} failed: ${(err as Error).message}`);
    }
  }
}
