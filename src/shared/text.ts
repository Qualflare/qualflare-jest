/**
 * Rune-safe truncation for wire fields the server bounds.
 *
 * "Runes" means Unicode CODE POINTS, which is what the server counts. A plain
 * `s.slice(0, n)` counts UTF-16 code units instead, so it both over-counts
 * (an emoji is two units, one rune) and can cut a surrogate pair in half,
 * putting a lone surrogate on the wire. Test output contains emoji routinely.
 */
export function truncateRunes(value: string, maxRunes: number): string {
  // Fast path: UTF-16 length is always >= the code-point count, so if the
  // cheap measure already fits, the real one does too. Matters because these
  // are called per attempt on strings that can be hundreds of KB.
  if (value.length <= maxRunes) {
    return value;
  }
  const runes = Array.from(value);
  if (runes.length <= maxRunes) {
    return value;
  }
  return runes.slice(0, maxRunes).join('');
}

/**
 * Bounds captured stdout/stderr to what the server actually stores: the first
 * `maxLines` lines, then a total-rune budget across them.
 *
 * The server joins the lines with newlines into one column and truncates the
 * result, so the `+ 1` per line accounts for the separator it will add.
 * Returns `undefined` when nothing survives, so the field is omitted rather
 * than sent empty.
 */
export function clampOutputLines(
  lines: readonly string[],
  maxLines: number,
  maxRunes: number,
): string[] | undefined {
  const out: string[] = [];
  let budget = maxRunes;

  for (const line of lines.slice(0, maxLines)) {
    const cost = Array.from(line).length + 1;
    if (cost > budget) {
      // Keep a partial final line rather than dropping it whole — a truncated
      // last line of a stack trace is still worth more than nothing.
      if (budget > 1) {
        out.push(truncateRunes(line, budget - 1));
      }
      break;
    }
    out.push(line);
    budget -= cost;
  }

  return out.length > 0 ? out : undefined;
}
