test.skip('is skipped statically', () => {
  throw new Error('never runs');
});

test('runs after a skipped test', () => {
  expect(true).toBe(true);
});

test.todo('is a todo');
