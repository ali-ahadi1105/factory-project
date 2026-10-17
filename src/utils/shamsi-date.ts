/**
 * Shamsi (Persian Solar Hijri / Jalali) date formatting utilities.
 *
 * These helpers are dependency-free and rely on the platform `Intl` API, so no
 * third-party calendar library is required. When a `timeZone` is not supplied
 * the host time zone is used, which keeps the Shamsi and Gregorian output
 * aligned to the same instant and calendar day.
 *
 * @example
 * formatShamsi('2026-10-17T12:30:00Z', { timeZone: 'Asia/Tehran' });
 * // => 'شنبه ۲۵ مهر ۱۴۰۵'
 *
 * formatShamsiIso(new Date(), { timeZone: 'Asia/Tehran' });
 * // => '1405-07-25'
 */

/** Any value accepted by the {@link Date} constructor, or a `Date` itself. */
export type DateInput = Date | number | string;

/** Common formatting options shared by the date helpers. */
export interface DateFormatOptions {
  /** Append the time of day (HH:mm) to the formatted output. */
  withTime?: boolean;
  /** IANA time zone, e.g. `Asia/Tehran`. Defaults to the host time zone. */
  timeZone?: string;
}

/** Options for {@link formatShamsi}. */
export interface ShamsiFormatOptions extends DateFormatOptions {
  /** Emit Latin digits instead of Persian-Indic digits. Defaults to `false`. */
  latinDigits?: boolean;
}

/** Options for the ISO-like helpers. */
export interface IsoFormatOptions {
  /** IANA time zone, e.g. `Asia/Tehran`. Defaults to the host time zone. */
  timeZone?: string;
}

const SHAMSI_LOCALE = 'fa-IR-u-ca-persian';
const SHAMSI_LOCALE_LATIN = 'en-US-u-ca-persian';
const SHAMSI_LOCALE_FALLBACK = 'fa-IR';
const SHAMSI_LOCALE_LATIN_FALLBACK = 'en-US';

/**
 * Coerce a {@link DateInput} into a valid `Date`.
 *
 * @throws {RangeError} When the input cannot be parsed into a valid date.
 */
export function toDate(input: DateInput): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date input: ${String(input)}`);
  }
  return date;
}

function buildIntlOptions(options: DateFormatOptions): Intl.DateTimeFormatOptions {
  const intlOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  };
  if (options.timeZone) {
    intlOptions.timeZone = options.timeZone;
  }
  if (options.withTime) {
    intlOptions.hour = '2-digit';
    intlOptions.minute = '2-digit';
  }
  return intlOptions;
}

/**
 * Format a date using the Persian Solar Hijri (Shamsi/Jalali) calendar.
 *
 * By default the output uses Persian-Indic digits and Persian month/weekday
 * names (e.g. `شنبه ۲۵ مهر ۱۴۰۵`). Pass `latinDigits` to render the same date
 * with Latin digits.
 */
export function formatShamsi(input: DateInput, options: ShamsiFormatOptions = {}): string {
  const date = toDate(input);
  const intlOptions = buildIntlOptions(options);
  const locale = options.latinDigits ? SHAMSI_LOCALE_LATIN : SHAMSI_LOCALE;
  const fallback = options.latinDigits ? SHAMSI_LOCALE_LATIN_FALLBACK : SHAMSI_LOCALE_FALLBACK;

  try {
    return new Intl.DateTimeFormat(locale, intlOptions).format(date);
  } catch {
    return new Intl.DateTimeFormat(fallback, intlOptions).format(date);
  }
}

/**
 * Produce an ISO-like Persian calendar date (`YYYY-MM-DD`, Latin digits) for
 * report numbers and filenames. Shares the host time zone with
 * {@link formatShamsi} for consistency.
 */
export function formatShamsiIso(input: DateInput, options: IsoFormatOptions = {}): string {
  const date = toDate(input);
  const intlOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (options.timeZone) {
    intlOptions.timeZone = options.timeZone;
  }

  const parts = new Intl.DateTimeFormat(SHAMSI_LOCALE_LATIN, intlOptions).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Format a date using the Gregorian calendar via native `Intl`.
 *
 * Uses the same (host) time zone as {@link formatShamsi} so that the Shamsi and
 * Gregorian dates always describe the same instant and calendar day.
 */
export function formatGregorian(input: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(input);
  return new Intl.DateTimeFormat('en-US', buildIntlOptions(options)).format(date);
}

/**
 * ISO-like Gregorian calendar date (`YYYY-MM-DD`).
 *
 * Defaults to the host time zone; pass `timeZone` to render the date in a
 * specific zone while still describing the same instant.
 */
export function formatGregorianIso(input: DateInput, options: IsoFormatOptions = {}): string {
  const date = toDate(input);

  if (!options.timeZone) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: options.timeZone,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
