import { describe, expect, it } from 'vitest';
import { formatHours, isZeroHours } from './hours';

describe('formatHours', () => {
  it('always shows two decimals without floating-point conversion', () => {
    expect(formatHours('8')).toBe('8.00');
    expect(formatHours('7.5')).toBe('7.50');
    expect(formatHours('0.10')).toBe('0.10');
    expect(formatHours('123.45')).toBe('123.45');
  });
  it('returns unexpected values untouched instead of guessing', () => {
    expect(formatHours('abc')).toBe('abc');
  });
});

describe('isZeroHours', () => {
  it('detects zero values', () => {
    expect(isZeroHours('0.00')).toBe(true);
    expect(isZeroHours('0')).toBe(true);
    expect(isZeroHours('0.01')).toBe(false);
    expect(isZeroHours('8.00')).toBe(false);
  });
});
