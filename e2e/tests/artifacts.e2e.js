const { qualflare } = require('../../dist/index.cjs');

// A real PNG header, not arbitrary bytes: the CLI's upload endpoint cross-checks
// the extension against the MIME type it is handed, so the verifier asserts the
// written file really is a PNG rather than merely named one.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('attaches a screenshot, which travels out of band', () => {
  // Jest captures no artifacts of its own, so the metadata API is the only
  // image source. It takes the same localImagePath route as a framework
  // screenshot would.
  qualflare.attachment('screenshot', PNG_MAGIC.toString('base64'), {
    encoding: 'base64',
    mimeType: 'image/png',
  });
  expect(PNG_MAGIC.byteLength).toBe(8);
});
