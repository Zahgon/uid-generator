/*
 * Reimplementation shim: the `java.util.Date` / `java.text.SimpleDateFormat`
 * behaviour the component depends on.
 *
 * Two things here are contractual:
 *
 *   1. the `yyyy-MM-dd`, `yyyy-MM-dd HH:mm:ss` and `yyyy-MM-dd HH:mm:ss.SSS`
 *      patterns, in the *default time zone*, because `UidGenerator.parseUID`
 *      embeds one of them in its output; and
 *   2. `Date.toString()`, `EEE MMM dd HH:mm:ss zzz yyyy`, because
 *      `WorkerNodeEntity.toString()` reflects over a `Date` field and the
 *      result is logged.
 *
 * Only the pattern letters those three patterns use are supported. Anything
 * else is a programming error rather than a formatting fall-back, so it throws.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Thrown where the JDK throws `java.text.ParseException`. */
export class ParseException extends Error {
  readonly errorOffset: number;

  constructor(message: string, errorOffset: number) {
    super(message);
    this.name = 'ParseException';
    this.errorOffset = errorOffset;
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * `SimpleDateFormat.format`, restricted to the `y M d H m s S` pattern letters
 * and rendering in the host's default time zone, as the JDK does.
 */
export function formatPattern(date: Date, pattern: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  let out = '';
  let index = 0;
  while (index < pattern.length) {
    const letter = pattern[index]!;
    if (!/[A-Za-z]/.test(letter)) {
      out += letter;
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < pattern.length && pattern[index + run] === letter) {
      run += 1;
    }
    index += run;
    switch (letter) {
      case 'y':
        out += run === 2
          ? pad(date.getFullYear() % 100, 2)
          : pad(date.getFullYear(), run);
        break;
      case 'M':
        out += run >= 3 ? MONTHS[date.getMonth()]! : pad(date.getMonth() + 1, run);
        break;
      case 'd':
        out += pad(date.getDate(), run);
        break;
      case 'H':
        out += pad(date.getHours(), run);
        break;
      case 'm':
        out += pad(date.getMinutes(), run);
        break;
      case 's':
        out += pad(date.getSeconds(), run);
        break;
      case 'S':
        out += pad(date.getMilliseconds(), run);
        break;
      default:
        throw new Error(`Unsupported pattern letter '${letter}' in '${pattern}'`);
    }
  }
  return out;
}

/**
 * `SimpleDateFormat.parse` for the same restricted pattern set, lenient as
 * commons-lang's `DateUtils.parseDate` configures it: out-of-range components
 * roll over instead of failing. Returns `null` when the pattern does not
 * consume the whole input, which is how the caller decides to try the next
 * pattern.
 */
export function parsePattern(text: string, pattern: string): Date | null {
  const fields = { year: 1970, month: 0, day: 1, hour: 0, minute: 0, second: 0, milli: 0 };
  let cursor = 0;
  let index = 0;

  const readDigits = (max: number): number | null => {
    let digits = '';
    while (cursor < text.length && digits.length < max && /[0-9]/.test(text[cursor]!)) {
      digits += text[cursor]!;
      cursor += 1;
    }
    return digits.length === 0 ? null : Number(digits);
  };

  while (index < pattern.length) {
    const letter = pattern[index]!;
    if (!/[A-Za-z]/.test(letter)) {
      if (text[cursor] !== letter) {
        return null;
      }
      cursor += 1;
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < pattern.length && pattern[index + run] === letter) {
      run += 1;
    }
    index += run;
    // A numeric field that is not followed by another numeric field may run on
    // past its pattern width, exactly as SimpleDateFormat does.
    const width = index < pattern.length && /[A-Za-z]/.test(pattern[index]!) ? run : 10;
    const value = readDigits(width);
    if (value === null) {
      return null;
    }
    switch (letter) {
      case 'y': fields.year = value; break;
      case 'M': fields.month = value - 1; break;
      case 'd': fields.day = value; break;
      case 'H': fields.hour = value; break;
      case 'm': fields.minute = value; break;
      case 's': fields.second = value; break;
      case 'S': fields.milli = value; break;
      default: throw new Error(`Unsupported pattern letter '${letter}' in '${pattern}'`);
    }
  }

  if (cursor !== text.length) {
    return null;
  }
  const parsed = new Date(
    fields.year, fields.month, fields.day,
    fields.hour, fields.minute, fields.second, fields.milli,
  );
  // `new Date(y, …)` maps years 0-99 onto 1900-1999; the JDK does not. Correcting
  // it has to happen *after* normalisation and as a shift, not an assignment:
  // a lenient out-of-range day can roll the year forward, and assigning the
  // parsed year back would silently discard that.
  if (fields.year >= 0 && fields.year < 100) {
    parsed.setFullYear(parsed.getFullYear() - 1900);
  }
  return parsed;
}

/**
 * The short time-zone name `Date.toString()` renders for `zzz`.
 *
 * The JDK prints a CLDR short name where one exists ("UTC", "PDT") and a
 * `GMT±HH:MM` offset otherwise. ICU in Node reaches for the offset form more
 * readily than the JDK does, and writes it without zero padding, so the offset
 * form is renormalised to the JDK's spelling here.
 */
export function shortTimeZoneName(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (offset === null) {
    return name;
  }
  return `GMT${offset[1]!}${pad(Number(offset[2]!), 2)}:${offset[3] ?? '00'}`;
}

/** `java.util.Date.toString()`: `EEE MMM dd HH:mm:ss zzz yyyy`. */
export function dateToString(date: Date): string {
  return [
    WEEKDAYS[date.getDay()]!,
    MONTHS[date.getMonth()]!,
    pad(date.getDate(), 2),
    `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`,
    shortTimeZoneName(date),
    String(date.getFullYear()),
  ].join(' ');
}
