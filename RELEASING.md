# Releasing

## Cutting a release

1. Ensure `main` is green: `.github/workflows/ci.yml` passing (unit tests + the real-jest
   integration suite across the full `{jest, node}` version matrix, plus the packaged-tarball
   example job and the no-network check).
2. Bump `version` in `package.json` (follow semver — this package has no compiled binary and no
   platform-specific variants, so a plain version bump is the whole change).
3. Update `CHANGELOG.md` with the new version's changes.
4. Commit: `chore: release vX.Y.Z`.
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z` — pushing the tag triggers
   `.github/workflows/npm-publish.yml`, which verifies the tag matches `package.json`'s version,
   re-runs the full quality gate (typecheck/lint/build/unit test), and publishes to npm with
   provenance attestation (`id-token: write`, matching `qualflare-cli`'s and `qualflare-cypress`'s
   publish pattern).
6. Confirm the publish succeeded: `npm view @qualflare/jest version` should show the new
   version, and the npm package page should show a "Provenance" badge.

## 1.0.0 checklist specifically

Beyond the steps above, before the first `1.0.0`:

- [ ] The real-jest integration suite (`npm run test:integration`) has been run successfully in CI
      across the full declared `peerDependencies["jest"]` range, not just locally — including the
      3.0 leg, which is what proves the `annotations()` feature detection actually works.
- [ ] **Manual smoke test against a live Qualflare account** — this cannot be automated in CI (it
      needs a real project to observe results in): run `examples/basic` (see its own README), then
      upload its `outputDir` with `qf <identifier> collect ./qualflare-results`, and confirm in the
      Qualflare UI that the resulting Launch shows the expected
      suites/cases/steps/labels/screenshots correctly — this is the actual end-to-end proof that the
      wire-contract implementation matches what's live in production, not just what the fixture
      assertions in `test/integration/` cover. The credential lives with the CLI
      (`qf login <identifier> <token>`); this formatter has none.
- [ ] **The matching `qualflare-cli` release is already published** — this package writes a report
      format only `qualflare-cli >= v0.1.16` can parse. Publishing a reporter ahead of the CLI that
      reads it produces silent data loss for anyone who upgrades: the run writes files nothing can
      collect.
- [ ] `docs/CONFIGURATION.md`, `docs/LIMITATIONS.md`, and `docs/METADATA-API.md` reviewed for
      accuracy against the actual shipped `src/config/resolve-config.ts`/`src/runtime/qualflare-api.ts`
      (not the other way around — code is the source of truth, regenerate docs from it if they've
      drifted).
- [ ] README quickstart tested by someone who hasn't worked on this package, following it verbatim
      in a fresh Jest project.
- [ ] Decide deliberately whether `BeforeAll`/`AfterAll` attachment capture and per-attempt retry
      detail (both documented v1 gaps in `docs/LIMITATIONS.md`) are worth a backend extension before
      1.0, or stay out of scope.
