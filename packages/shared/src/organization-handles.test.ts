import { describe, expect, it } from 'vitest';
import { isValidOrganizationHandle, organizationHandleBase, organizationHandleCandidates } from './organization-handles';
import { growthMs, linearGrowthLimit } from './testing/growth';

const take = (iterator: Generator<string>, count: number) => Array.from({ length: count }, () => iterator.next().value);

describe('organization handles', () => {
  it('slugifies the name like the backfill', () => {
    expect(organizationHandleBase('Acme Docs!', 'cabc123xyz')).toBe('acme-docs');
    expect(organizationHandleBase('  --Sara’s  organization-- ', 'cabc123xyz')).toBe('sara-s-organization');
  });

  it('falls back to org-<id> for empty and reserved names', () => {
    expect(organizationHandleBase('مؤسسة سارة', 'CABC123xyz')).toBe('org-cabc12');
    expect(organizationHandleBase('Settings', 'cabc123xyz')).toBe('org-cabc12');
    expect(organizationHandleBase('new', 'cabc123xyz')).toBe('org-cabc12');
  });

  it('caps the base at 48 characters without a trailing dash', () => {
    const base = organizationHandleBase(`${'a'.repeat(47)} b c`, 'cabc123xyz');
    expect(base.length).toBeLessThanOrEqual(48);
    expect(base.endsWith('-')).toBe(false);
  });

  it('suffixes -2, -3… after the base', () => {
    expect(take(organizationHandleCandidates('Acme', 'cabc123xyz'), 3)).toEqual(['acme', 'acme-2', 'acme-3']);
  });

  it('validates handles', () => {
    expect(isValidOrganizationHandle('acme-docs')).toBe(true);
    expect(isValidOrganizationHandle('welcome')).toBe(false);
    expect(isValidOrganizationHandle('Acme')).toBe(false);
    expect(isValidOrganizationHandle('a--b')).toBe(false);
  });
});

describe('organizationHandleBase on adversarial input', () => {
  it('trims long runs of separators in linear time', () => {
    const name = (n: number) => `${'-'.repeat(n)}acme${'-'.repeat(n)}x`;
    expect(organizationHandleBase(name(100_000), 'abcdef123')).toBe('acme-x');
    expect(organizationHandleBase('-'.repeat(200_000), 'abcdef123')).toBe('org-abcdef');
    // 4x the separators costs about 4x (testing/growth).
    const [small, large] = growthMs((input: string) => organizationHandleBase(input, 'abcdef123'), name(25_000), name(100_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
  it('drops a trailing separator left by the 48-character cap', () => {
    expect(organizationHandleBase(`${'a'.repeat(47)} b`, 'abcdef123')).toBe('a'.repeat(47));
  });
});
