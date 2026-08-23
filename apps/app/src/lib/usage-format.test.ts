import { describe, expect, it } from 'vitest';
import { formatByteQuantity, getByteQuantityParts } from './usage-format';

describe('getByteQuantityParts', () => {
  it('preserves a useful decimal remainder without converting through Number', () => {
    expect(getByteQuantityParts('1610612736')).toEqual({ whole: 1n, tenth: 5n, unit: 'gib' });
  });

  it('keeps exact bigint arithmetic at the signed Int64 maximum', () => {
    expect(getByteQuantityParts('9223372036854775807')).toEqual({ whole: 8_589_934_591n, tenth: 9n, unit: 'gib' });
    expect(getByteQuantityParts('-9223372036854775808')).toEqual({ whole: -8_589_934_592n, tenth: 0n, unit: 'gib' });
  });

  it('chooses the unit from absolute magnitude and preserves a negative correction sign', () => {
    expect(getByteQuantityParts('-1610612736')).toEqual({ whole: -1n, tenth: 5n, unit: 'gib' });
  });

  it.each([
    ['en', '.', 'GiB', '1.5 GiB'],
    ['ar', '٫', 'غيبيبايت', '١٫٥ غيبيبايت'],
  ])('renders the decimal remainder with %s digits and unit order', (locale, separator, gib, expected) => {
    const tag = locale === 'ar' ? 'ar-u-nu-arab' : locale;
    const number = (value: bigint) => new Intl.NumberFormat(tag).format(value);
    expect(
      formatByteQuantity('1610612736', {
        number,
        decimal: (whole, fraction) => `${whole}${separator}${fraction}`,
        unit: (value, unit) => `${value} ${unit === 'gib' ? gib : unit}`,
      }),
    ).toBe(expected);
  });

  it.each([
    ['en', '.', 'GiB', '-1.5 GiB'],
    ['ar', '٫', 'غيبيبايت', '\u061c-١٫٥ غيبيبايت'],
  ])('renders a negative decimal correction with %s digits and sign', (locale, separator, gib, expected) => {
    const tag = locale === 'ar' ? 'ar-u-nu-arab' : locale;
    const number = (value: bigint) => new Intl.NumberFormat(tag).format(value);
    expect(
      formatByteQuantity('-1610612736', {
        number,
        decimal: (whole, fraction) => `${whole}${separator}${fraction}`,
        unit: (value, unit) => `${value} ${unit === 'gib' ? gib : unit}`,
      }),
    ).toBe(expected);
  });
});
