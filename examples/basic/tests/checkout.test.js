const { qualflare } = require('@qualflare/jest');

describe('checkout', () => {
  test('totals a cart', () => {
    qualflare.description('Adds two items and checks the total.');
    qualflare.parameter('currency', 'USD');
    expect(2 * 2100).toBe(4200);
  });
});
