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

  it('does not expose newly added draft redirects before the first successful publish', () => {
    expect(overlayLiveConfigPreservingPublishedRedirects({ styling: {} }, { redirects: [{ from: '/draft', to: '/page' }] })).toEqual({});
  });

  it('lets an empty live config clear chrome without clearing published redirects', () => {
    const redirects = [{ from: '/old', to: '/current' }];
    expect(overlayLiveConfigPreservingPublishedRedirects({ styling: { theme: 'dark' }, redirects }, {})).toEqual({ redirects });
  });
});
