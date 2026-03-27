import { describe, it, expect } from 'vitest';
import { compareSemver, esc, pad } from '../src/main/utils.js';

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns positive when first is newer (patch)', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('returns negative when first is older (patch)', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('compares major versions', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('compares minor versions', () => {
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0);
  });

  it('handles different length versions', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
  });

  it('treats missing segments as 0', () => {
    expect(compareSemver('1.0.0', '1')).toBe(0);
    expect(compareSemver('1.0.1', '1')).toBeGreaterThan(0);
  });
});

describe('esc (CSV escaping)', () => {
  it('wraps plain string in quotes', () => {
    expect(esc('hello')).toBe('"hello"');
  });

  it('doubles internal quotes', () => {
    expect(esc('say "hi"')).toBe('"say ""hi"""');
  });

  it('handles commas', () => {
    expect(esc('a,b')).toBe('"a,b"');
  });

  it('handles null', () => {
    expect(esc(null)).toBe('""');
  });

  it('handles undefined', () => {
    expect(esc(undefined)).toBe('""');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('""');
  });

  it('handles newlines', () => {
    expect(esc('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('pad', () => {
  it('pads single digit', () => {
    expect(pad(0)).toBe('00');
    expect(pad(5)).toBe('05');
  });

  it('leaves two-digit numbers unchanged', () => {
    expect(pad(10)).toBe('10');
    expect(pad(59)).toBe('59');
  });
});
