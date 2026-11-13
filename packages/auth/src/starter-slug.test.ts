import { isProjectHostnameAllowed, RESERVED_PROJECT_HOSTNAMES } from '@nibleaf/shared/project-hostname';
import { describe, expect, it } from 'vitest';
import { pickStarterSlug, STARTER_SLUG_BASE, starterFallbackSlug, starterSlugCandidates } from './starter-slug';

const takenBy = (slugs: string[]) => async (slug: string) => slugs.includes(slug);

describe('starter site address (P0-DASH-001)', () => {
  it('gives the first site on a fresh instance an address its own settings form can save', async () => {
    const slug = await pickStarterSlug(takenBy([]), []);
    expect(slug).toBe(STARTER_SLUG_BASE);
    expect(RESERVED_PROJECT_HOSTNAMES).not.toContain(slug);
    // The same rule the API applies when an address is chosen or changed.
    expect(isProjectHostnameAllowed(slug)).toBe(true);
  });

  it('never offers a reserved address, including this deployment’s own hosts', () => {
    const hosts = ['https://documentation.example.test', 'https://documentation-2.example.test'];
    const candidates = starterSlugCandidates(hosts, () => 'abcd1234');
    expect(candidates).not.toContain('documentation');
    expect(candidates).not.toContain('documentation-2');
    expect(candidates[0]).toBe('documentation-3');
    for (const reserved of RESERVED_PROJECT_HOSTNAMES) expect(candidates).not.toContain(reserved);
    expect(candidates.some((slug) => slug.startsWith('xn--'))).toBe(false);
  });

  it('moves on to a numbered address, then a random one, when earlier ones are taken', async () => {
    const numbered = Array.from({ length: 8 }, (_, index) => `${STARTER_SLUG_BASE}-${index + 2}`);
    expect(await pickStarterSlug(takenBy([STARTER_SLUG_BASE]), [])).toBe(`${STARTER_SLUG_BASE}-2`);
    expect(await pickStarterSlug(takenBy([STARTER_SLUG_BASE, ...numbered]), [])).toMatch(/^documentation-[a-f0-9]{8}$/);
  });

  it('still returns a valid address when every candidate is taken', async () => {
    const slug = await pickStarterSlug(async () => true, []);
    expect(slug).toMatch(/^documentation-[a-z0-9]+$/);
    expect(isProjectHostnameAllowed(slug)).toBe(true);
  });

  it('never falls back to a timestamp address this deployment reserves', () => {
    const now = () => 1_700_000_000_000;
    const stamped = `documentation-${now().toString(36)}`;
    const hosts = [`https://${stamped}.example.test`];
    const slug = starterFallbackSlug(hosts, now, () => 'feedbeef');
    expect(slug).toBe(`${stamped}-feedbeef`);
    expect(isProjectHostnameAllowed(slug, hosts)).toBe(true);
    expect(starterFallbackSlug([], now)).toBe(stamped);
  });
});
