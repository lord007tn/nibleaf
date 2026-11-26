import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RootMarketingAnalytics } from './root-marketing-analytics';

describe('RootMarketingAnalytics SSR boundary', () => {
  it.each([
    { pathname: '/app/projects/project-1', siteProjectId: undefined },
    { pathname: '/sites/project-1/guide', siteProjectId: 'project-1' },
    { pathname: '/sign-in', siteProjectId: undefined },
  ])('omits the global marketing query boundary on $pathname', ({ pathname, siteProjectId }) => {
    expect(renderToString(<RootMarketingAnalytics pathname={pathname} siteProjectId={siteProjectId} language="en" />)).toBe('');
  });
});
