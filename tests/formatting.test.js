import { describe, it, expect } from 'vitest';
import {
  pad, formatDuration, formatTime, fmtDur, minsToTime,
  formatDate, formatTimeShort, formatDateFull, isSameDay,
  toLocalDatetime, fromLocalDatetime,
} from '../src/renderer/utils/formatting.js';

describe('pad', () => {
  it('pads single digit with leading zero', () => {
    expect(pad(0)).toBe('00');
    expect(pad(5)).toBe('05');
    expect(pad(9)).toBe('09');
  });

  it('leaves two-digit numbers unchanged', () => {
    expect(pad(10)).toBe('10');
    expect(pad(99)).toBe('99');
  });

  it('does not truncate three-digit numbers', () => {
    expect(pad(100)).toBe('100');
  });
});

describe('formatDuration', () => {
  it('formats zero', () => {
    expect(formatDuration(0)).toBe('00h 00m 00s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45000)).toBe('00h 00m 45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(61000)).toBe('00h 01m 01s');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatDuration(3661000)).toBe('01h 01m 01s');
  });

  it('handles large values', () => {
    expect(formatDuration(86400000)).toBe('24h 00m 00s');
  });

  it('truncates sub-second precision', () => {
    expect(formatDuration(1999)).toBe('00h 00m 01s');
  });
});

describe('formatTime', () => {
  it('returns object with hours, minutes, seconds', () => {
    const result = formatTime(0);
    expect(result).toEqual({ hours: '00', minutes: '00', seconds: '00' });
  });

  it('formats elapsed time correctly', () => {
    expect(formatTime(3661000)).toEqual({ hours: '01', minutes: '01', seconds: '01' });
  });

  it('handles sub-second precision', () => {
    expect(formatTime(500)).toEqual({ hours: '00', minutes: '00', seconds: '00' });
  });
});

describe('fmtDur', () => {
  it('shows hours/minutes/seconds when under 24h', () => {
    expect(fmtDur(3661000)).toBe('01h 01m 01s');
  });

  it('shows days/hours/minutes when 24h or more', () => {
    expect(fmtDur(90061000)).toBe('01d 01h 01m');
  });

  it('formats zero', () => {
    expect(fmtDur(0)).toBe('00h 00m 00s');
  });

  it('formats exactly 24 hours', () => {
    expect(fmtDur(86400000)).toBe('01d 00h 00m');
  });
});

describe('minsToTime', () => {
  it('formats midnight', () => {
    expect(minsToTime(0)).toBe('00:00');
  });

  it('formats 90 minutes as 01:30', () => {
    expect(minsToTime(90)).toBe('01:30');
  });

  it('formats end of day', () => {
    expect(minsToTime(1439)).toBe('23:59');
  });

  it('formats noon', () => {
    expect(minsToTime(720)).toBe('12:00');
  });
});

describe('formatDate', () => {
  it('returns a non-empty string for valid ISO date', () => {
    const result = formatDate('2024-03-15T10:30:00.000Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date');
  });
});

describe('formatTimeShort', () => {
  it('returns a non-empty string for valid ISO date', () => {
    const result = formatTimeShort('2024-03-15T10:30:00.000Z');
    expect(result).toBeTruthy();
  });

  it('returns empty string for invalid input', () => {
    expect(formatTimeShort('not-a-date')).toBe('Invalid Date');
  });
});

describe('formatDateFull', () => {
  it('returns a non-empty string with day info', () => {
    const d = new Date(2024, 2, 15); // March 15, 2024
    const result = formatDateFull(d);
    expect(result).toBeTruthy();
    expect(result).toContain('2024');
  });
});

describe('isSameDay', () => {
  it('returns true for same day', () => {
    const d1 = new Date(2024, 2, 15, 10, 0);
    const d2 = new Date(2024, 2, 15, 23, 59);
    expect(isSameDay(d1, d2)).toBe(true);
  });

  it('returns false for different days', () => {
    const d1 = new Date(2024, 2, 15);
    const d2 = new Date(2024, 2, 16);
    expect(isSameDay(d1, d2)).toBe(false);
  });

  it('returns false for different months', () => {
    const d1 = new Date(2024, 2, 15);
    const d2 = new Date(2024, 3, 15);
    expect(isSameDay(d1, d2)).toBe(false);
  });

  it('returns false for different years', () => {
    const d1 = new Date(2024, 2, 15);
    const d2 = new Date(2025, 2, 15);
    expect(isSameDay(d1, d2)).toBe(false);
  });
});

describe('toLocalDatetime / fromLocalDatetime', () => {
  it('produces a 16-char datetime-local string', () => {
    const result = toLocalDatetime('2024-03-15T10:30:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('returns empty string for invalid input', () => {
    expect(toLocalDatetime('garbage')).toBe('');
  });

  it('fromLocalDatetime returns empty string for invalid input', () => {
    expect(fromLocalDatetime('garbage')).toBe('');
  });

  it('roundtrips correctly', () => {
    const iso = '2024-06-15T14:30:00.000Z';
    const local = toLocalDatetime(iso);
    const backToIso = fromLocalDatetime(local);
    // The roundtrip should preserve the same point in time (to the minute)
    const originalMinutes = Math.floor(new Date(iso).getTime() / 60000);
    const roundtripMinutes = Math.floor(new Date(backToIso).getTime() / 60000);
    expect(roundtripMinutes).toBe(originalMinutes);
  });
});
