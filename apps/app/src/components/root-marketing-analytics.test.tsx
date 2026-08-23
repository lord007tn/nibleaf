import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: { pathname: '/' } }),
}));

import { RootMarketingAnalytics } from './root-marketing-analytics';

describe('RootMarketingAnalytics SSR boundary', () => {
  it('renders a marketing URL with its own query provider', () => {
    expect(() => renderToString(<RootMarketingAnalytics pathname="/" language="en" />)).not.toThrow();
  });

  it.each([
    { pathname: '/app/projects/project-1', siteProjectId: undefined },
    { pathname: '/sites/project-1/guide', siteProjectId: 'project-1' },
    { pathname: '/sign-in', siteProjectId: undefined },
  ])('omits the global marketing query boundary on $pathname', ({ pathname, siteProjectId }) => {
    expect(renderToString(<RootMarketingAnalytics pathname={pathname} siteProjectId={siteProjectId} language="en" />)).toBe('');
  });
});
