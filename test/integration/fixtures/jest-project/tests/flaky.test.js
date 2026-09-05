jest.retryTimes(2);
let attempts = 0;
test('fails twice then passes', () => {
  attempts += 1;
  if (attempts < 3) throw new Error(`intentional failure ${attempts}`);
  expect(attempts).toBe(3);
});
