// A user who mocks fs must not have their assertions polluted by the
// reporter's own writes. Without jest.requireActual('node:fs') in channel.ts,
// our appendFileSync lands on THEIR mock and this test fails -- meaning the
// package would break suites that pass today.
jest.mock('node:fs');
const fs = require('node:fs');
const { qualflare } = require('../../../../../dist/index.cjs');

test('the reporter does not appear in a user fs mock', () => {
  qualflare.label('team', 'platform');
  qualflare.parameter('plan', 'pro');
  expect(fs.appendFileSync).not.toHaveBeenCalled();
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});
