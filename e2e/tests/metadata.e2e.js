const { qualflare } = require('../../dist/index.cjs');

// The baseline. Distinguishes "no report" from "a report that lost its cases".
test('reports a plain passing test', () => {
  expect(1 + 1).toBe(2);
});

test('records the author-facing metadata API', () => {
  qualflare.label('team', 'platform');
  qualflare.link('https://github.com/Qualflare/qualflare-jest', {
    type: 'custom',
    name: 'repository',
  });
  qualflare.tag('dogfood');
  qualflare.description('Exercises every metadata call the README documents.');
  qualflare.priority('high');
  qualflare.parameter('plan', 'enterprise');
  expect(true).toBe(true);
});

test('nests steps', async () => {
  await qualflare.step('outer', async () => {
    qualflare.parameter('scope', 'outer');
    await qualflare.step('inner', () => {
      expect('nested').toHaveLength(6);
    });
  });
});

// Redacted AT SOURCE -- the value never reaches the channel file, let alone the
// report. verify-report.mjs asserts the secret is absent from the whole payload,
// which is the only assertion that can prove that.
test('redacts a masked parameter', () => {
  qualflare.parameter('apiKey', 'qf-dogfood-secret-value', { masked: true });
  expect(true).toBe(true);
});
