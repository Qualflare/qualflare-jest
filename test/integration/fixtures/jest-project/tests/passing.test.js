const { qualflare } = require('../../../../../dist/index.cjs');

test('passes', () => {
  expect(1 + 1).toBe(2);
});

test('records metadata', () => {
  qualflare.label('team', 'platform');
  qualflare.tag('smoke');
  qualflare.parameter('plan', 'pro');
  qualflare.parameter('apiKey', 'super-secret-value', { masked: true });
  expect(true).toBe(true);
});
