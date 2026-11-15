import { projectConfigSchema } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  clamp,
  colorProblem,
  editColor,
  editRadius,
  hexText,
  hexToHsl,
  hslToHex,
  parseHex,
  shownColor,
  stylingPatch,
  stylingValues,
} from './styling';

describe('parseHex', () => {
  it.each([
    ['#5546e8', '#5546e8'],
    ['5546E8', '#5546e8'],
    ['#5546E8', '#5546e8'],
    [' #abc ', '#aabbcc'],
    ['ABC', '#aabbcc'],
    ['#FfF', '#ffffff'],
    ['000', '#000000'],
  ])('reads %j as the stored %s', (text, stored) => {
    expect(parseHex(text)).toBe(stored);
    // What it stores passes the API's own check.
    expect(projectConfigSchema.safeParse({ styling: { primaryColor: stored } }).success).toBe(true);
  });

  it.each(['', '#', '#a', '#ab', '#abcd', '#abcde', '#abcdefa', '#ggg', 'red', '##abc', '#12 34'])('refuses %j', (text) => {
    expect(parseHex(text)).toBeNull();
  });
});

describe('editing the color', () => {
  it('keeps the text the person types as #-prefixed uppercase, as the field shows it', () => {
    expect(hexText('ab')).toBe('#AB');
    expect(hexText('#12f')).toBe('#12F');
  });

  it('a color that differs only by case, #, or short against long form is not an edit', () => {
    for (const typed of ['#AABBCC', 'aabbcc', '#abc', 'ABC']) expect(editColor(typed, '#aabbcc')).toBe('#aabbcc');
  });

  it('typing the shown default over an unset color leaves it unset', () => {
    expect(editColor('#5546E8', '')).toBe('');
    expect(editColor('#5546e9', '')).toBe('#5546e9');
  });

  it('a new color is stored in its long lowercase form; partial or invalid text stays as typed and is a problem', () => {
    expect(editColor('#0EA', '#5546e8')).toBe('#00eeaa');
    expect(editColor('#0E', '#5546e8')).toBe('#0E');
    expect(colorProblem('#0E')).toBe('invalidHex');
    expect(colorProblem('#00eeaa')).toBeNull();
    expect(colorProblem('')).toBeNull();
    expect(shownColor('')).toBe('#5546e8');
    expect(shownColor('#0E')).toBeNull();
  });
});

describe('radius', () => {
  it('choosing what an unset radius shows keeps it unset; any other choice sets it', () => {
    expect(editRadius('rounded', '')).toBe('');
    expect(editRadius('sharp', '')).toBe('sharp');
    expect(editRadius('rounded', 'sharp')).toBe('rounded');
    expect(editRadius('sharp', 'sharp')).toBe('sharp');
  });
});

describe('stylingValues', () => {
  it('reads what is stored, a short color in its long form, and unset as blank', () => {
    expect(stylingValues({ primaryColor: '#ABC', radius: 'pill', theme: 'dark' })).toStrictEqual({ primaryColor: '#aabbcc', radius: 'pill' });
    expect(stylingValues(undefined)).toStrictEqual({ primaryColor: '', radius: '' });
    expect(stylingValues({ theme: 'light' })).toStrictEqual({ primaryColor: '', radius: '' });
  });
});

describe('stylingPatch', () => {
  const baseline = { primaryColor: '#5546e8', radius: '' as const };

  it('sends only what changed, never the appearance', () => {
    expect(stylingPatch({ ...baseline, primaryColor: '#0ea5e9' }, baseline)).toStrictEqual({ primaryColor: '#0ea5e9' });
    expect(stylingPatch({ ...baseline, radius: 'pill' }, baseline)).toStrictEqual({ radius: 'pill' });
    expect(stylingPatch(baseline, baseline)).toStrictEqual({});
  });

  it('a set radius changed back to rounded is sent', () => {
    expect(stylingPatch({ primaryColor: '', radius: 'rounded' }, { primaryColor: '', radius: 'sharp' })).toStrictEqual({ radius: 'rounded' });
  });

  it('never sends text that is not a color, or a blank', () => {
    expect(stylingPatch({ primaryColor: '#12', radius: '' }, baseline)).toStrictEqual({});
    expect(stylingPatch({ primaryColor: '', radius: '' }, baseline)).toStrictEqual({});
  });
});

describe('HSL', () => {
  it.each([
    ['#000000', { h: 0, s: 0, l: 0 }],
    ['#ffffff', { h: 0, s: 0, l: 100 }],
    ['#808080', { h: 0, s: 0, l: 50 }],
    ['#ff0000', { h: 0, s: 100, l: 50 }],
    ['#00ff00', { h: 120, s: 100, l: 50 }],
    ['#0000ff', { h: 240, s: 100, l: 50 }],
    ['#5546e8', { h: 246, s: 78, l: 59 }],
  ])('%s is %o', (hex, hsl) => {
    expect(hexToHsl(hex)).toStrictEqual(hsl);
  });

  it('hue 0 and 360 are the same red; black, white and grays ignore hue and saturation', () => {
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe('#ff0000');
    expect(hslToHex({ h: 360, s: 100, l: 50 })).toBe('#ff0000');
    expect(hslToHex({ h: 200, s: 80, l: 0 })).toBe('#000000');
    expect(hslToHex({ h: 200, s: 80, l: 100 })).toBe('#ffffff');
    expect(hslToHex({ h: 200, s: 0, l: 50 })).toBe('#808080');
  });

  it('clamps to the sliders’ ranges', () => {
    expect(hslToHex({ h: 400, s: 150, l: -5 })).toBe('#000000');
    expect(hslToHex({ h: -10, s: 100, l: 50 })).toBe('#ff0000');
    expect(clamp(Number('x'), 0, 100)).toBe(0);
    expect(clamp(120, 0, 100)).toBe(100);
  });

  it('a stored color round-trips through its HSL within one step per channel', () => {
    for (const hex of ['#5546e8', '#0ea5e9', '#16a34a', '#eab308', '#db2777', '#0f172a']) {
      const back = hslToHex(hexToHsl(hex) ?? { h: 0, s: 0, l: 0 });
      for (const at of [1, 3, 5]) {
        expect(Math.abs(Number.parseInt(back.slice(at, at + 2), 16) - Number.parseInt(hex.slice(at, at + 2), 16))).toBeLessThanOrEqual(3);
      }
    }
  });
});
