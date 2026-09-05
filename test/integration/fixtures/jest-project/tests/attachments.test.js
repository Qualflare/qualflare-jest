const { qualflare } = require('../../../../../dist/index.cjs');

// A real PNG header, not arbitrary bytes: the CLI's upload endpoint
// cross-checks the extension against the MIME type, so the assertion checks
// the written file really is a PNG rather than merely named one.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('attaches an image and a note', async () => {
  qualflare.attachment('shot', PNG_MAGIC.toString('base64'), {
    encoding: 'base64',
    mimeType: 'image/png',
  });
  qualflare.attachment('note', 'hello from the fixture');
  await qualflare.step('outer', async () => {
    qualflare.parameter('scope', 'outer');
    await qualflare.step('inner', () => {
      expect(true).toBe(true);
    });
  });
});

test('an oversized attachment is skipped, not fatal', () => {
  qualflare.attachment('huge', 'x'.repeat(8_000_000));
  expect(true).toBe(true);
});
