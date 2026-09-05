const { qualflare } = require('@qualflare/jest');

describe('login', () => {
  test('signs a user in', async () => {
    qualflare.label('feature', 'auth');
    qualflare.link('https://example.com/issue/1', { type: 'issue', name: 'QF-1' });
    qualflare.tag('smoke');
    qualflare.priority('high');

    await qualflare.step('submit the form', () => {
      qualflare.parameter('user', 'ada');
      qualflare.parameter('password', 'hunter2', { masked: true });
      expect(true).toBe(true);
    });
  });
});
