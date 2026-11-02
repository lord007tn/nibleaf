import { describe, expect, it } from 'vitest';
import { normalizeType } from './callouts';

describe('normalizeType', () => {
  it('maps the GitHub caution keyword to danger', () => {
    expect(normalizeType('caution')).toBe('danger');
  });
  it('maps important to info, case-insensitively', () => {
    expect(normalizeType('IMPORTANT')).toBe('info');
  });
  it('passes known types through', () => {
    expect(normalizeType('warning')).toBe('warning');
    expect(normalizeType('tip')).toBe('tip');
  });
  it('defaults unknown or missing values to note', () => {
    expect(normalizeType('zzz')).toBe('note');
    expect(normalizeType(undefined)).toBe('note');
  });
});
