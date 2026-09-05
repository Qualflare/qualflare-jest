import { describe, expect, it } from 'vitest';

import { MASKED_PLACEHOLDER, buildParameter, propertyValue } from '../../src/shared/parameters.js';

describe('masked parameters never carry the value off the machine', () => {
  // The whole point. `masked` used to be a display hint: the real value was
  // sent, stored server-side in plaintext and readable back through the API,
  // while only the UI drew dots over it. Anyone who believed the name and
  // passed a token got no protection at all.
  it('drops the value entirely from a masked step parameter', () => {
    const p = buildParameter('token', 'super-secret-value', true);

    expect(p.masked).toBe(true);
    expect(p.value).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('super-secret-value');
  });

  it('keeps the value when not masked', () => {
    expect(buildParameter('sku', 'BOOK-1', false)).toEqual({ name: 'sku', value: 'BOOK-1' });
    expect(buildParameter('sku', 'BOOK-1')).toEqual({ name: 'sku', value: 'BOOK-1' });
  });

  it('omits value rather than sending an empty string when there is none', () => {
    expect(buildParameter('flag', undefined)).toEqual({ name: 'flag' });
  });

  // A case-level parameter is flattened into `properties`, a flat
  // Record<string, string> with nowhere to put the flag. Without a placeholder
  // the choice was between leaking the value and dropping the parameter.
  it('substitutes a placeholder when a masked parameter must become a property', () => {
    const v = propertyValue('super-secret-value', true);

    expect(v).toBe(MASKED_PLACEHOLDER);
    expect(v).not.toContain('super-secret-value');
  });

  it('passes an unmasked property value through unchanged', () => {
    expect(propertyValue('plain', false)).toBe('plain');
    expect(propertyValue(undefined, false)).toBe('');
  });

  // The placeholder is what the UI already renders for a masked step
  // parameter, so a redacted value is indistinguishable from a hidden one.
  it('uses the same glyphs the UI renders', () => {
    expect(MASKED_PLACEHOLDER).toBe('\u2022\u2022\u2022\u2022\u2022\u2022');
  });
});
