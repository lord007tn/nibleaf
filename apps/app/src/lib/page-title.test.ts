import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
  it('names the page, then where it is, then the product', () => {
    expect(pageTitle('Members', "Ada's workspace")).toBe("Members · Ada's workspace · Nibleaf");
    expect(pageTitle('General', 'Documentation')).toBe('General · Documentation · Nibleaf');
  });

  it('leaves out parts that are still loading or empty', () => {
    expect(pageTitle('Settings', undefined)).toBe('Settings · Nibleaf');
    expect(pageTitle(null, '  ', 'Docs')).toBe('Docs · Nibleaf');
    expect(pageTitle()).toBe('Nibleaf');
  });
});
