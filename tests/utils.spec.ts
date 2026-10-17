import {
  toDate,
  formatShamsi,
  formatShamsiIso,
  formatGregorian,
  formatGregorianIso,
} from '../src/utils';

// 2026-10-17T12:30:00Z is 16:00 on Saturday, 25 Mehr 1405 in Tehran (UTC+3:30).
const INSTANT = new Date('2026-10-17T12:30:00.000Z');
const TEHRAN = 'Asia/Tehran';

describe('Shamsi date utilities', () => {
  describe('toDate', () => {
    it('should return the same instance for a valid Date', () => {
      expect(toDate(INSTANT)).toBe(INSTANT);
    });

    it('should parse ISO strings and epoch numbers', () => {
      expect(toDate('2026-10-17T12:30:00.000Z').getTime()).toBe(INSTANT.getTime());
      expect(toDate(INSTANT.getTime()).getTime()).toBe(INSTANT.getTime());
    });

    it('should throw a RangeError for invalid input', () => {
      expect(() => toDate('not-a-date')).toThrow(RangeError);
      expect(() => toDate(new Date('invalid'))).toThrow(RangeError);
    });
  });

  describe('formatShamsi', () => {
    it('should render the Persian calendar with Persian digits and month name', () => {
      const result = formatShamsi(INSTANT, { timeZone: TEHRAN });
      expect(result).toContain('۱۴۰۵');
      expect(result).toContain('مهر');
      expect(result).toContain('شنبه');
    });

    it('should support Latin digits when requested', () => {
      const result = formatShamsi(INSTANT, { timeZone: TEHRAN, latinDigits: true });
      expect(result).toContain('1405');
      expect(result).toContain('Mehr');
      expect(result).not.toContain('۱۴۰۵');
    });

    it('should append the time of day when withTime is set', () => {
      const result = formatShamsi(INSTANT, { timeZone: TEHRAN, withTime: true });
      expect(result).toContain('۱۶:۰۰');
    });

    it('should accept string and numeric date inputs', () => {
      expect(formatShamsi('2026-10-17T12:30:00.000Z', { timeZone: TEHRAN })).toContain('۱۴۰۵');
      expect(formatShamsi(INSTANT.getTime(), { timeZone: TEHRAN })).toContain('۱۴۰۵');
    });
  });

  describe('formatShamsiIso', () => {
    it('should format a Latin-digit Persian calendar date', () => {
      expect(formatShamsiIso(INSTANT, { timeZone: TEHRAN })).toBe('1405-07-25');
    });

    it('should respect the supplied time zone across midnight', () => {
      const justBefore = new Date('2026-10-16T21:00:00.000Z'); // 00:30 on the 17th in Tehran
      expect(formatShamsiIso(justBefore, { timeZone: TEHRAN })).toBe('1405-07-25');
      expect(formatShamsiIso(justBefore, { timeZone: 'UTC' })).toBe('1405-07-24');
    });
  });

  describe('formatGregorian', () => {
    it('should render a Gregorian date aligned with the same instant', () => {
      const result = formatGregorian(INSTANT, { timeZone: 'UTC' });
      expect(result).toContain('Saturday');
      expect(result).toContain('October');
      expect(result).toContain('17');
      expect(result).toContain('2026');
    });

    it('should append the time of day when withTime is set', () => {
      const result = formatGregorian(INSTANT, { timeZone: 'UTC', withTime: true });
      expect(result).toContain('12:30');
    });
  });

  describe('formatGregorianIso', () => {
    it('should produce a local ISO date by default', () => {
      const local = new Date(2026, 9, 17, 12, 0, 0);
      expect(formatGregorianIso(local)).toBe('2026-10-17');
    });

    it('should honour an explicit time zone', () => {
      const justBefore = new Date('2026-10-16T21:00:00.000Z');
      expect(formatGregorianIso(justBefore, { timeZone: 'Asia/Tehran' })).toBe('2026-10-17');
      expect(formatGregorianIso(justBefore, { timeZone: 'UTC' })).toBe('2026-10-16');
    });
  });
});
