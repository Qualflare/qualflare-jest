# @qualflare/jest — basic example

A minimal Jest project wired to the reporter, exactly as the package README
describes. CI runs this against a packed tarball, so it is also the check that
catches the example drifting from the real API.

```bash
npm install
npm test
```

That writes a report into `qualflare-results/`. The reporter makes **no network
calls** — uploading is a separate step:

```bash
npm install -g @qualflare/cli
qf login my-project "$QUALFLARE_TOKEN" --force
qf my-project collect ./qualflare-results
```

`jest.config.js` uses the typed `qualflareReporter()` helper; the equivalent
literal is `['@qualflare/jest/reporter', { ... }]`.
