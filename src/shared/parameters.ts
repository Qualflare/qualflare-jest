import type { Parameter } from './types.js';

/**
 * What a masked parameter's value is replaced with before it leaves this
 * process. Matches the glyphs the Qualflare UI already renders for a masked
 * step parameter, so a redacted value looks identical to a hidden one.
 */
export const MASKED_PLACEHOLDER = '\u2022\u2022\u2022\u2022\u2022\u2022';

/**
 * Builds one wire `Parameter`, dropping the value entirely when it is masked.
 *
 * `masked` used to be a display hint and nothing more: the real value was sent,
 * stored server-side in plaintext, and readable back through the API — only the
 * UI drew dots over it. Anyone who believed the name and passed a token got no
 * protection at all, which is why the docs had to say "never put a real secret
 * in one".
 *
 * Redacting here is what makes the name true. The secret never leaves the
 * machine, and the UI is unaffected because it renders from the `masked` flag
 * rather than from the value.
 *
 * The trade-off is deliberate: a masked value is now unrecoverable. That is the
 * point of masking it.
 */
export function buildParameter(name: string, value: string | undefined, masked?: boolean): Parameter {
  if (masked) {
    return { name, masked: true };
  }
  return { name, ...(value !== undefined ? { value } : {}) };
}

/**
 * The value a masked parameter takes when it has to be flattened into a case's
 * `properties`, which is a flat `Record<string, string>` with nowhere to put the
 * flag. Without this the choice was between leaking the value and dropping the
 * parameter.
 */
export function propertyValue(value: string | undefined, masked?: boolean): string {
  return masked ? MASKED_PLACEHOLDER : (value ?? '');
}
