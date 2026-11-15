import { projectConfigSchema } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { type BrandingValues, brandingUpdate, brandingValues, normalizeBranding, uploadResultAction } from './branding';

const blank: BrandingValues = { logoLight: '', logoDark: '', favicon: '', logoHref: '' };
const saved: BrandingValues = { logoLight: '/logo/light.svg', logoDark: '/logo/dark.svg', favicon: '/favicon.svg', logoHref: 'https://acme.example' };

/** The API's config merge (apps/server/src/actions/projects.ts `mergeConfig`): sections one level deep. */
const mergeConfig = (existing: Record<string, unknown>, incoming: Record<string, unknown>) => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key];
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(previous && typeof previous === 'object' ? previous : {}), ...value }
        : value;
  }
  return merged;
};

describe('brandingValues', () => {
  it('reads a cleared (null), missing or absent field as blank', () => {
    expect(brandingValues(undefined)).toEqual(blank);
    expect(brandingValues({})).toEqual(blank);
    expect(brandingValues({ branding: null })).toEqual(blank);
    expect(brandingValues({ branding: { logoLight: null, logoDark: null, favicon: null, logoHref: null } })).toEqual(blank);
  });

  it('reads stored values trimmed, so stray spaces in old data are not an edit', () => {
    expect(brandingValues({ branding: { logoLight: ' /logo/light.svg ', favicon: '/favicon.svg' } })).toEqual({
      ...blank,
      logoLight: '/logo/light.svg',
      favicon: '/favicon.svg',
    });
  });
});

describe('normalizeBranding', () => {
  it('trims every field and keeps blanks blank', () => {
    expect(normalizeBranding({ logoLight: '  /a.svg', logoDark: '/b.svg  ', favicon: '   ', logoHref: '\thttps://x.example\n' })).toEqual({
      logoLight: '/a.svg',
      logoDark: '/b.svg',
      favicon: '',
      logoHref: 'https://x.example',
    });
  });
});

describe('brandingUpdate', () => {
  it('sends only the fields that changed, trimmed', () => {
    expect(brandingUpdate(saved, { ...saved, favicon: '  /icons/new.png ' })).toEqual({ favicon: '/icons/new.png' });
  });

  it('sends a cleared field as null, never as an empty string', () => {
    expect(brandingUpdate(saved, { ...saved, logoDark: '   ', logoHref: '' })).toEqual({ logoDark: null, logoHref: null });
  });

  it('sends nothing for a whitespace-only change', () => {
    expect(brandingUpdate(saved, { ...saved, logoLight: ' /logo/light.svg ' })).toEqual({});
  });

  it('is a patch of config.branding alone: the merge keeps every sibling section and untouched branding field', () => {
    const stored = {
      theme: { preset: 'nib' },
      styling: { primaryColor: '#0f766e' },
      redirects: [{ from: '/old', to: '/new' }],
      branding: { logoLight: '/logo/light.svg', logoDark: '/logo/dark.svg', favicon: '/favicon.svg', logoHref: 'https://acme.example' },
    };
    const patch = { branding: brandingUpdate(saved, { ...saved, favicon: '/icons/new.png' }) };
    expect(mergeConfig(stored, patch)).toEqual({ ...stored, branding: { ...stored.branding, favicon: '/icons/new.png' } });
  });

  it('clears all four saved values through real serialization, the API schema and merge, and a refetch, keeping explicit null', () => {
    const stored = { theme: { preset: 'nib' }, branding: { ...saved } };
    const body = JSON.parse(JSON.stringify({ config: { branding: brandingUpdate(saved, blank) } }));
    expect(body).toEqual({ config: { branding: { logoLight: null, logoDark: null, favicon: null, logoHref: null } } });
    const accepted = projectConfigSchema.parse(body.config);
    const merged = mergeConfig(stored, accepted);
    const refetched = JSON.parse(JSON.stringify(merged));
    expect(refetched.branding).toEqual({ logoLight: null, logoDark: null, favicon: null, logoHref: null });
    expect(refetched.theme).toEqual({ preset: 'nib' });
    expect(brandingValues(refetched)).toEqual(blank);
    // Saving again from the refetched baseline sends nothing more.
    expect(brandingUpdate(brandingValues(refetched), blank)).toEqual({});
  });
});

describe('uploadResultAction', () => {
  const request = { field: 'favicon', draft: 3, startedFrom: '/favicon.svg' } as const;

  it('fills the field when its draft is still here and the field is as the upload found it', () => {
    expect(uploadResultAction(request, { draft: 3, value: '/favicon.svg' })).toBe('apply');
  });

  it('lets an edit or a clear made since the upload began win', () => {
    expect(uploadResultAction(request, { draft: 3, value: '/typed.svg' })).toBe('superseded');
    expect(uploadResultAction(request, { draft: 3, value: '' })).toBe('superseded');
  });

  it('drops a result whose draft was discarded or belongs to another site visit, whatever the field holds', () => {
    expect(uploadResultAction(request, { draft: 4, value: '/favicon.svg' })).toBe('stale');
    expect(uploadResultAction(request, { draft: 5, value: '' })).toBe('stale');
  });
});
