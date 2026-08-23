import { describe, expect, it } from 'vitest';
import { overlayLiveConfigPreservingPublishedRedirects } from './published-config';

describe('overlayLiveConfigPreservingPublishedRedirects', () => {
  it('keeps live chrome while serving only redirects from the READY snapshot', () => {
    const publishedRedirects = [{ from: '/old', to: '/current' }];
    expect(
      overlayLiveConfigPreservingPublishedRedirects(
        { styling: { theme: 'light' }, redirects: publishedRedirects },
        { styling: { theme: 'dark' }, redirects: [{ from: '/draft', to: '/missing' }] },
      ),
    ).toEqual({ styling: { theme: 'dark' }, redirects: publishedRedirects });
  });

  it('keeps versioned theme sections in draft until they are published together', () => {
    const published = {
      theme: { preset: 'harbor' },
      styling: { theme: 'light' },
      typography: { bodyFont: 'Inter' },
      branding: { logoLight: '/published.svg' },
      seo: { metaTitle: 'Published title' },
    };
    const live = {
      theme: { preset: 'signal' },
      styling: { theme: 'dark' },
      typography: { bodyFont: 'Noto Sans Arabic' },
      branding: { logoLight: '/draft.svg' },
      seo: { metaTitle: 'Live title' },
    };

    expect(overlayLiveConfigPreservingPublishedRedirects(published, live)).toEqual({
      theme: { preset: 'harbor' },
      styling: { theme: 'light' },
      typography: { bodyFont: 'Inter' },
      branding: { logoLight: '/published.svg' },
      seo: { metaTitle: 'Live title' },
    });
  });

  it('does not expose the first versioned theme before its first publish', () => {
    expect(
      overlayLiveConfigPreservingPublishedRedirects(
        { styling: { theme: 'light', primaryColor: '#2563eb' } },
        { theme: { preset: 'signal' }, styling: { theme: 'dark', primaryColor: '#5b35d5' } },
      ),
    ).toEqual({ styling: { theme: 'light', primaryColor: '#2563eb' } });
  });

  it('does not expose newly added draft redirects before the first successful publish', () => {
    expect(overlayLiveConfigPreservingPublishedRedirects({ styling: {} }, { redirects: [{ from: '/draft', to: '/page' }] })).toEqual({});
  });

  it('lets an empty live config clear chrome without clearing published redirects', () => {
    const redirects = [{ from: '/old', to: '/current' }];
    expect(overlayLiveConfigPreservingPublishedRedirects({ styling: { theme: 'dark' }, redirects }, {})).toEqual({ redirects });
  });
});
