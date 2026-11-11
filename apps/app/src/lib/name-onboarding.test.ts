import { describe, expect, it } from 'vitest';
import { nameReturnPath } from './name-onboarding';

describe('name step return destination', () => {
  it('preserves a dashboard path, query and fragment', () => {
    expect(nameReturnPath('/app/projects/p1?lang=ar#members')).toBe('/app/projects/p1?lang=ar#members');
  });
  it.each([
    undefined,
    '',
    'https://evil.example/app',
    '//evil.example/app',
    '/\\evil.example/app',
    'javascript:alert(1)',
    '/app/../../sign-out',
    '/welcome/name',
    '/join/token',
    '/accept-invite/token',
    '/app/..//evil.example',
    '/app\\..\\sign-out',
  ])('rejects %s', (value) => {
    expect(nameReturnPath(value)).toBe('/app');
  });
});
