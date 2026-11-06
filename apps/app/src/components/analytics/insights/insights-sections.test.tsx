// @vitest-environment jsdom

import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  mutate: vi.fn(),
  overview: vi.fn(),
  pages: vi.fn(),
  page: vi.fn(),
  search_: vi.fn(),
  feedback: vi.fn(),
  ai: vi.fn(),
  performance: vi.fn(),
  legacy: vi.fn(),
  deployments: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, mocks.locale);
  return { useT: () => t, useLocale: () => ({ t, locale: mocks.locale, setLocale: vi.fn() }) };
});
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => mocks.locale, subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => mocks.search, useParams: () => ({ projectId: 'p1' }) }),
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    to,
    search,
    params,
    activeProps: _activeProps,
    activeOptions: _activeOptions,
    ...rest
  }: {
    children?: ReactNode;
    to: string;
    search?: Record<string, unknown>;
    params?: { projectId: string };
    activeProps?: unknown;
    activeOptions?: unknown;
  }) => (
    <a data-search={JSON.stringify(search ?? {})} data-to={to} href={to.replace('$projectId', params?.projectId ?? '')} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api/mutations', () => ({ useCreatePage: () => ({ mutate: mocks.mutate, isPending: false }) }));
vi.mock('@/hooks/api', () => ({
  useDeployments: mocks.deployments,
  useDomains: () => ({ data: [{ domain: 'docs.example.com', isPrimary: true, verified: true }] }),
  usePages: () => ({ data: [{ id: 'page-getting-started', path: 'getting-started', kind: 'PAGE' }] }),
  useProject: () => ({ data: { id: 'p1', slug: 'docs' } }),
}));
vi.mock('@/hooks/api/analytics', () => ({
  useOverviewInsights: mocks.overview,
  usePagesInsights: mocks.pages,
  usePageInsights: mocks.page,
  useSearchInsights: mocks.search_,
  useFeedbackInsights: mocks.feedback,
  useAiVisibilityInsights: mocks.ai,
  usePerformanceInsights: mocks.performance,
  useProjectAnalytics: mocks.legacy,
}));

import { AiSection } from './ai-section';
import { FeedbackSection } from './feedback-section';
import { InsightsFilterBar } from './filter-bar';
import { OverviewSection } from './overview-section';
import { PagesSection } from './pages-section';
import { PerformanceSection } from './performance-section';
import { SearchSection } from './search-section';
import {
  aiFixture,
  emptyOverview,
  feedbackFixture,
  meta,
  overviewFixture,
  pageDetailFixture,
  pagesFixture,
  performanceFixture,
  searchFixture,
} from './test-fixtures';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

const ready = <T,>(data: T) => ({ data, isPending: false, isError: false });
const loading = { data: undefined, isPending: true, isError: false };
const failed = { data: undefined, isPending: false, isError: true };

beforeEach(() => {
  mocks.locale = 'en';
  mocks.search = {};
  mocks.deployments.mockReturnValue({ data: [{ status: 'READY' }] });
  mocks.legacy.mockReturnValue({ data: undefined, isPending: true, isError: false });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(element: ReactElement, direction: 'ltr' | 'rtl' = 'ltr') {
  const container = document.createElement('div');
  container.dir = direction;
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<DirectionProvider direction={direction}>{element}</DirectionProvider>));
  return container;
}

const text = (element: Element) => element.textContent ?? '';
const headings = (element: Element) => [...element.querySelectorAll('h2')].map(text);

describe('Overview', () => {
  it('answers the docs-owner questions with numbers and period comparisons', async () => {
    mocks.overview.mockReturnValue(ready(overviewFixture()));
    const view = await render(<OverviewSection />);

    expect(headings(view)).toEqual(
      expect.arrayContaining([
        'What are people reading?',
        "What can't they find?",
        'Which articles need work?',
        'How do people find you?',
        'Was it helpful?',
        'Are AI assistants finding your docs?',
      ]),
    );
    expect(text(view)).toContain('1,240');
    expect(text(view)).toContain('webhooks');
    expect(text(view)).toContain('Often “not helpful”');
    expect(text(view)).toContain('AI assistants');
    expect(text(view)).toMatch(/Data last received/);
    // A higher zero-result rate is bad news even though the arrow points up.
    const zeroResult = [...view.querySelectorAll('[title]')].find((node) => node.getAttribute('title') === 'Up +4 pts from the previous period');
    expect(zeroResult?.className).toContain('text-destructive');
    const views = [...view.querySelectorAll('[title]')].find((node) => node.getAttribute('title') === 'Up +24% from the previous period');
    expect(views?.className).toContain('text-success');
    // Unknown previous value: no invented comparison.
    expect(text(view)).not.toContain('NaN');
    const drillDown = view.querySelector<HTMLAnchorElement>('a[data-to="/app/projects/$projectId/analytics/pages"][data-search*="getting-started"]');
    expect(JSON.parse(drillDown?.dataset.search ?? '{}')).toEqual({ path: 'getting-started' });
    expect(view.querySelector('[dir="ltr"][title="/getting-started"]')).not.toBeNull();
  });

  it('shows skeletons while loading', async () => {
    mocks.overview.mockReturnValue(loading);
    const view = await render(<OverviewSection />);
    expect(view.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
  });

  it('invites the owner to publish when no reader has ever visited', async () => {
    mocks.overview.mockReturnValue(ready(emptyOverview()));
    const view = await render(<OverviewSection />);
    expect(headings(view)).toContain('No visits yet');
    expect(text(view)).toContain('Data appears here within a minute');
  });

  it('separates "no visits in this period" from "nothing received for a day" on a published site', async () => {
    const data = emptyOverview();
    data.meta.lastEventAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mocks.overview.mockReturnValue(ready(data));
    const view = await render(<OverviewSection />);
    expect(headings(view)).toContain('No visits in this period');
    expect(text(view)).toContain('No new visits in the last 24 hours');
  });

  it('renders unknown figures as a dash, never zero, when analytics is unavailable', async () => {
    mocks.overview.mockReturnValue(ready(emptyOverview('unavailable')));
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('Analytics is temporarily unavailable');
    expect(text(view)).toContain('Your docs site is not affected');
    const values = [...view.querySelectorAll('[data-slot="card-title"]')].map(text);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === '—' || !/^\d/.test(value))).toBe(true);
  });

  it('treats a failed request like an outage', async () => {
    mocks.overview.mockReturnValue(failed);
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('Analytics is temporarily unavailable');
  });

  it('explains how to enable ClickHouse analytics when it is not configured', async () => {
    mocks.overview.mockReturnValue(ready(emptyOverview('not_configured')));
    const view = await render(<OverviewSection />);
    const guide = view.querySelector<HTMLAnchorElement>('a[href="https://docs.nibleaf.com/self-hosting/clickhouse-analytics"]');
    expect(guide).not.toBeNull();
    expect(text(view)).toContain('ClickHouse');
    expect(view.querySelectorAll('[data-slot="card-title"]')).toHaveLength(0);
  });

  it('flags incomplete data without hiding what is known', async () => {
    mocks.overview.mockReturnValue(ready(overviewFixture('partial')));
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('Some figures are incomplete');
    expect(text(view)).toContain('1,240');
  });

  it('renders in Arabic, right to left, with paths kept left to right', async () => {
    mocks.locale = 'ar';
    mocks.overview.mockReturnValue(ready(overviewFixture()));
    const view = await render(<OverviewSection />, 'rtl');
    expect(headings(view)).toContain('ماذا يقرأ الناس؟');
    expect(text(view)).toContain('عمّا يبحثون ولا يجدونه؟');
    expect(text(view)).not.toMatch(/analytics\.[a-z]/i);
    const arabicPath = view.querySelector('[title="/ar/دليل"]');
    expect(arabicPath?.getAttribute('dir')).toBe('ltr');
    expect(view.querySelector('[dir="auto"]')).not.toBeNull();
  });
});

describe('Pages', () => {
  it('sorts, filters and links every row to its drill-down', async () => {
    mocks.pages.mockReturnValue(ready(pagesFixture(30)));
    const view = await render(<PagesSection />);
    const table = view.querySelector('table');
    expect(table?.querySelector('caption')?.textContent).toBe('Pages with their reading statistics');
    expect(view.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(text(view)).toContain('Page 1 of 2');
    expect(text(view)).toContain('Slow to load');

    const viewsHeader = [...view.querySelectorAll('th')].find((th) => text(th).startsWith('Views'));
    expect(viewsHeader?.getAttribute('aria-sort')).toBe('descending');
    await act(async () => viewsHeader?.querySelector('button')?.click());
    expect(viewsHeader?.getAttribute('aria-sort')).toBe('ascending');

    const filter = view.querySelector<HTMLInputElement>('input[type="search"]');
    if (!filter) throw new Error('expected the filter input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(filter, 'page-12');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const rows = view.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const link = rows[0]?.querySelector<HTMLAnchorElement>('a');
    expect(JSON.parse(link?.dataset.search ?? '{}')).toEqual({ path: 'page-12' });
  });

  it('shows the empty state for a site without visits', async () => {
    mocks.pages.mockReturnValue(ready({ ...pagesFixture(0), meta: meta('complete', { lastEventAt: null }) }));
    const view = await render(<PagesSection />);
    expect(headings(view)).toContain('No visits yet');
  });

  it('drills into one page with live and editor links, journeys, speed and crawlers', async () => {
    mocks.page.mockReturnValue(ready(pageDetailFixture()));
    const view = await render(<PagesSection path="getting-started" />);
    expect(mocks.page).toHaveBeenCalledWith('p1', expect.objectContaining({ range: '30d' }), 'getting-started');
    expect(view.querySelector<HTMLAnchorElement>('a[href="https://docs.example.com/getting-started"]')?.target).toBe('_blank');
    const edit = view.querySelector<HTMLAnchorElement>('a[data-to="/app/projects/$projectId/editor"]');
    expect(JSON.parse(edit?.dataset.search ?? '{}')).toEqual({ page: 'page-getting-started' });
    expect(text(view)).toContain('Where they went next');
    expect(text(view)).toContain('github.com');
    expect(text(view)).toContain('install');
    expect(text(view)).toContain('GPTBot');
    expect(text(view)).toContain('Needs improvement');
    expect(text(view)).toContain('Poor');
  });
});

describe('Search', () => {
  it('turns a failed search into a draft article and opens it in the editor', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture()));
    const view = await render(<SearchSection />);
    expect(text(view)).toContain('Searches that failed');
    expect(text(view)).toContain('sso');
    const write = view.querySelector<HTMLButtonElement>('button[aria-label="Write an article for “webhooks”"]');
    expect(write?.textContent).toContain('Write an article for this');
    await act(async () => write?.click());
    expect(mocks.mutate).toHaveBeenCalledWith({ title: 'webhooks' }, expect.any(Object));

    const options = mocks.mutate.mock.calls[0]?.[1] as { onSuccess: (page: { id: string }) => void; onSettled: () => void };
    await act(async () => {
      options.onSuccess({ id: 'new-page' });
      options.onSettled();
    });
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId/editor', params: { projectId: 'p1' }, search: { page: 'new-page' } });
  });

  it('explains hidden terms, links to the setting and states the threshold', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    const view = await render(<SearchSection />);
    expect(text(view)).toContain('Search terms are hidden');
    expect(text(view)).toContain('Store public search terms');
    expect(text(view)).toContain('at least 2 different visits');
    expect(text(view)).toContain('7 terms across 9 searches');
    const settings = view.querySelector<HTMLAnchorElement>('a[data-to="/app/projects/$projectId/settings"]');
    expect(JSON.parse(settings?.dataset.search ?? '{}')).toEqual({ section: 'integrations' });
    expect(view.querySelector('button[aria-label^="Write an article"]')).toBeNull();
  });

  it('says private sites never store terms', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('private_site')));
    const view = await render(<SearchSection />);
    expect(text(view)).toContain('never stored');
    expect(view.querySelector('a[data-to="/app/projects/$projectId/settings"]')).toBeNull();
  });
});

describe('Feedback, AI visibility and performance', () => {
  it('lists pages worst first', async () => {
    mocks.feedback.mockReturnValue(ready(feedbackFixture()));
    const view = await render(<FeedbackSection />);
    const titles = [...view.querySelectorAll('tbody tr')].map((row) => row.querySelector('[dir="auto"]')?.textContent);
    expect(titles).toEqual(['Bad page', 'Good page', 'Unrated']);
  });

  it('explains crawler kinds and separates verified from self-identified bots', async () => {
    mocks.ai.mockReturnValue(ready(aiFixture()));
    const view = await render(<AiSection />);
    expect(text(view)).toContain('Three kinds of AI bots');
    expect(text(view)).toContain('Verified');
    expect(text(view)).toContain('Identified by user agent');
    expect(text(view)).toContain('ChatGPT');
    expect(text(view)).toContain('Other assistants');
    expect(text(view)).toContain('llms.txt');
  });

  it('rates web vitals and names the slowest pages', async () => {
    mocks.performance.mockReturnValue(ready(performanceFixture()));
    const view = await render(<PerformanceSection />);
    expect(text(view)).toContain('Main content shows up');
    expect(text(view)).toContain('Good');
    expect(text(view)).toContain('Needs improvement');
    expect(text(view)).toContain('Poor');
    expect(text(view)).toContain('API reference');
  });

  it.each([
    ['feedback', FeedbackSection, mocks.feedback],
    ['ai', AiSection, mocks.ai],
    ['performance', PerformanceSection, mocks.performance],
    ['search', SearchSection, mocks.search_],
  ] as const)('%s shows the unavailable notice on a failed request', async (_name, Section, hook) => {
    hook.mockReturnValue(failed);
    const view = await render(<Section />);
    expect(text(view)).toContain('Analytics is temporarily unavailable');
  });
});

describe('Filter bar', () => {
  it('switches presets and comparison through the URL owner', async () => {
    const onChange = vi.fn();
    const view = await render(<InsightsFilterBar filters={{}} onChange={onChange} timezone="Asia/Riyadh" />);
    expect(text(view)).toContain('Times shown in Asia/Riyadh');
    await act(async () => view.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click());
    expect(onChange).toHaveBeenLastCalledWith({ range: '7d' });
    await act(async () => view.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(onChange).toHaveBeenLastCalledWith({ compare: 'none' });
  });

  it('marks no preset as active for a custom range', async () => {
    const view = await render(
      <InsightsFilterBar filters={{ range: 'custom', from: '2026-10-01', to: '2026-10-31' }} onChange={vi.fn()} timezone="UTC" />,
    );
    expect([...view.querySelectorAll('[role="tab"]')].every((tab) => tab.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(view.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Oct');
  });
});
