/*
 * Reimplementation shim: `org.apache.commons.lang.StringUtils`, the two
 * predicates the component uses. "Blank" in commons-lang means null, empty, or
 * made entirely of characters `Character.isWhitespace` accepts.
 */

/**
 * `Character.isWhitespace`. It differs from JavaScript's `\s` at both ends:
 * it accepts the ASCII file/group/record/unit separators and the four
 * information separators, and it rejects the non-breaking spaces
 * (U+00A0, U+2007, U+202F) and the zero-width no-break space U+FEFF.
 */
export function isWhitespace(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  if (code === 0x00a0 || code === 0x2007 || code === 0x202f || code === 0xfeff) {
    return false;
  }
  if (code >= 0x1c && code <= 0x1f) {
    return true;
  }
  if (code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d) {
    return true;
  }
  return /\s/u.test(ch);
}

/** `StringUtils.isBlank(CharSequence)`. */
export function isBlank(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value.length === 0) {
    return true;
  }
  for (const ch of value) {
    if (!isWhitespace(ch)) {
      return false;
    }
  }
  return true;
}

/** `StringUtils.isNotBlank(CharSequence)`. */
export function isNotBlank(value: string | null | undefined): boolean {
  return !isBlank(value);
}

export const StringUtils = { isBlank, isNotBlank } as const;
