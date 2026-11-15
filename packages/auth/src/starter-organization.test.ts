import { describe, expect, it } from 'vitest';
import { starterOrganizationName } from './starter-organization';

describe('starter organization name', () => {
  it('uses organization terminology and only the first name', () => {
    expect(starterOrganizationName('Fictional Writer', 'en')).toBe("Fictional's organization");
    expect(starterOrganizationName('  Fictional  Writer  ', 'en')).toBe("Fictional's organization");
  });

  it.each([undefined, null, '', '   '])('uses the anonymous organization name for %j', (name) => {
    expect(starterOrganizationName(name, 'en')).toBe('My organization');
  });

  it('uses the request locale and safely falls back to English', () => {
    expect(starterOrganizationName('سارة أحمد', 'ar')).toBe('مؤسسة سارة');
    expect(starterOrganizationName(null, 'ar-SA')).toBe('مؤسستي');
    expect(starterOrganizationName('Fictional Writer', 'unknown')).toBe("Fictional's organization");
  });
});
