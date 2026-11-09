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
  createPending: false,
  updatePending: false,
  refetch: vi.fn(),
  overview: vi.fn(),
  pages: vi.fn(),
  page: vi.fn(),
  search_: vi.fn(),
  feedback: vi.fn(),
  ai: vi.fn(),
  performance: vi.fn(),
  deployments: vi.fn(),
  members: vi.fn(),
  session: vi.fn(),
  updateConfig: vi.fn(),
  invalidate: vi.fn(),
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
vi.mock('@/hooks/api/mutations', () => ({
  useCreatePage: () => ({ mutate: mocks.mutate, isPending: mocks.createPending }),
  useUpdateProjectConfig: () => ({ mutate: mocks.updateConfig, isPending: mocks.updatePending }),
}));
vi.mock('@/services/auth-client', () => ({ useSession: mocks.session }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock('@/hooks/api', () => ({
  useDeployments: mocks.deployments,
  useDomains: () => ({ data: [{ domain: 'docs.example.com', isPrimary: true, verified: true }] }),
  usePages: () => ({ data: [{ id: 'page-getting-started', path: 'getting-started', kind: 'PAGE' }] }),
  useProject: () => ({ data: { id: 'p1', slug: 'docs' } }),
  useProjectMembers: mocks.members,
}));
vi.mock('@/hooks/api/analytics', () => ({
  useOverviewInsights: mocks.overview,
  usePagesInsights: mocks.pages,
  usePageInsights: mocks.page,
  useSearchInsights: mocks.search_,
  useFeedbackInsights: mocks.feedback,
  useAiVisibilityInsights: mocks.ai,
  usePerformanceInsights: mocks.performance,
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

const ready = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false, refetch: mocks.refetch });
const loading = { data: undefined, isPending: true, isError: false, isFetching: true, refetch: mocks.refetch };
const failed = { data: undefined, isPending: false, isError: true, isFetching: false, refetch: mocks.refetch };

beforeEach(() => {
  mocks.locale = 'en';
  mocks.search = {};
  mocks.createPending = false;
  mocks.updatePending = false;
  mocks.deployments.mockReturnValue({ data: [{ status: 'READY' }] });
  mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'u1' }, role: 'admin' }] }, isPending: false, isError: false });
  mocks.session.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false });
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
const cardTitled = (element: Element, title: string) => {
  const heading = [...element.querySelectorAll('h2')].find((node) => text(node) === title);
  const card = heading?.closest('[data-slot="card"]');
  if (!card) throw new Error(`expected a card titled ${title}`);
  return card;
};

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
    expect(text(view)).toContain('Analytics is taking a break');
    expect(text(view)).toContain('Your docs site works normally');
    expect(text(view)).toContain('“—” means not known, not zero');
    // Calm, not a warning.
    const notice = view.querySelector('[data-insights-unavailable]');
    expect(notice?.className).not.toContain('warning');
    expect(notice?.className).not.toContain('destructive');
    const values = [...view.querySelectorAll('[data-slot="card-title"]')].map(text);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === '—' || !/^\d/.test(value))).toBe(true);
  });

  it('treats a failed request like an outage', async () => {
    mocks.overview.mockReturnValue(failed);
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('Analytics is taking a break');
  });

  it('checks again from the unavailable notice, showing progress on the button', async () => {
    mocks.overview.mockReturnValue(failed);
    const view = await render(<OverviewSection />);
    const retry = [...view.querySelectorAll('button')].find((button) => text(button) === 'Try again');
    expect(retry?.getAttribute('aria-busy')).toBeNull();
    expect(retry?.disabled).toBe(false);
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();

    mocks.overview.mockReturnValue({ ...failed, isFetching: true });
    const busy = await render(<OverviewSection />);
    const pending = [...busy.querySelectorAll('button')].find((button) => text(button) === 'Try again');
    expect(pending?.getAttribute('aria-busy')).toBe('true');
    expect(pending?.disabled).toBe(true);
  });

  it('offers no retry while figures are known', async () => {
    mocks.overview.mockReturnValue(ready(overviewFixture()));
    const view = await render(<OverviewSection />);
    expect([...view.querySelectorAll('button')].some((button) => text(button) === 'Try again')).toBe(false);
  });

  it('explains how to enable ClickHouse analytics when it is not configured', async () => {
    mocks.overview.mockReturnValue(ready(emptyOverview('not_configured')));
    const view = await render(<OverviewSection />);
    const guide = view.querySelector<HTMLAnchorElement>('a[href="https://docs.nibleaf.com/self-hosting/clickhouse-analytics"]');
    expect(guide).not.toBeNull();
    expect(text(view)).toContain('ClickHouse');
    expect(view.querySelectorAll('[data-slot="card-title"]')).toHaveLength(0);
  });

  it('explains dual-write collection without rendering unknown figures as zero', async () => {
    mocks.overview.mockReturnValue(ready(emptyOverview('reads_disabled')));
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('Analytics is being collected');
    expect(text(view)).toContain('ANALYTICS_MODE=clickhouse');
    expect(view.querySelector('a[target="_blank"]')).not.toBeNull();
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

  it('keeps the known no-result share when search terms are off, and links to the setting', async () => {
    mocks.overview.mockReturnValue(ready({ ...overviewFixture(), failedSearches: [], searchTermsVisibility: 'disabled_by_setting' }));
    const view = await render(<OverviewSection />);
    const card = cardTitled(view, "What can't they find?");
    expect(text(card)).toContain('12% of 300 searches in this period found nothing.');
    expect(text(card)).toContain("Search terms are off for this project, so what readers typed isn't stored.");
    expect(text(card)).not.toContain('No failed searches');
    const settings = card.querySelector<HTMLAnchorElement>('a[data-to="/app/projects/$projectId/settings"]');
    expect(JSON.parse(settings?.dataset.search ?? '{}')).toEqual({ section: 'integrations' });
  });

  it('says rare terms are hidden instead of "no failed searches" when searches did fail', async () => {
    mocks.overview.mockReturnValue(ready({ ...overviewFixture(), failedSearches: [] }));
    const view = await render(<OverviewSection />);
    const card = cardTitled(view, "What can't they find?");
    expect(text(card)).toContain('12% of 300 searches in this period found nothing.');
    expect(text(card)).toContain('stay hidden for privacy');
    expect(text(card)).not.toContain('No failed searches');
    expect(card.querySelector('a[data-to="/app/projects/$projectId/settings"]')).toBeNull();
  });

  it('only reports no failed searches when nothing came back empty', async () => {
    const data = overviewFixture();
    mocks.overview.mockReturnValue(ready({ ...data, failedSearches: [], kpis: { ...data.kpis, zeroResultRate: { value: 0, previous: 0 } } }));
    const view = await render(<OverviewSection />);
    expect(text(cardTitled(view, "What can't they find?"))).toContain('No failed searches in this period.');
  });

  it('renders compact KPI tiles two to a row on phones without changing the wide layout', async () => {
    mocks.overview.mockReturnValue(ready(overviewFixture()));
    const view = await render(<OverviewSection />);
    const tiles = [...view.querySelectorAll<HTMLElement>('[data-kpi-card]')];
    expect(tiles).toHaveLength(10);
    const grid = tiles[0]?.parentElement;
    expect(grid?.className).toContain('min-[340px]:grid-cols-2');
    expect(grid?.className).toContain('xl:grid-cols-4');
    expect(grid?.className).not.toContain('min-[420px]');
    const tile = tiles[0] as HTMLElement;
    expect(tile.className).toContain('max-sm:[--card-spacing:--spacing(3.5)]');
    const value = tile.querySelector('[data-kpi-value]');
    expect(value?.className).toContain('text-xl');
    expect(value?.className).toContain('sm:text-2xl');
    expect(value?.className).toContain('sm:@[220px]/card:text-3xl');
    // The hint stays in the tile from `sm` up and moves behind an info button below it.
    expect(tile.querySelector('[data-kpi-hint]')?.className).toContain('max-sm:hidden');
    const info = tile.querySelector<HTMLButtonElement>('button[data-kpi-info]');
    expect(info?.getAttribute('aria-label')).toBe('About “Page views”');
    expect(info?.className).toContain('sm:hidden');
    // The delta badge stays visible on phones; only the "vs. previous period" caption is dropped.
    const badge = tile.querySelector('[title="Up +24% from the previous period"]');
    expect(badge?.className).not.toContain('hidden');
    expect(badge?.nextElementSibling?.className).toContain('max-sm:hidden');
    await act(async () => info?.click());
    expect(document.body.textContent).toContain(text(tile.querySelector('[data-kpi-hint]') as Element));
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
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

  it('explains hidden terms in the page drill-down instead of an empty list', async () => {
    mocks.page.mockReturnValue(ready({ ...pageDetailFixture(), searchesLeadingHere: [], searchTermsVisibility: 'private_site' }));
    const view = await render(<PagesSection path="getting-started" />);
    const card = cardTitled(view, 'Searches that led here');
    expect(text(card)).toContain('This is a private site, so what readers typed is never stored.');
    expect(text(card)).not.toContain('No searches led here');
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
    // A same-frame double click creates one draft, not two.
    await act(async () => {
      write?.click();
      write?.click();
    });
    expect(mocks.mutate).toHaveBeenCalledOnce();
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

  it('keeps hidden-term lists truthful when the setting is off', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    const view = await render(<SearchSection />);
    const failed = cardTitled(view, 'Searches that failed');
    expect(text(failed)).toContain('Searches with no results in this period: 6.');
    expect(text(failed)).toContain('Turn on search terms (see the note above)');
    expect(text(failed)).not.toContain('Every search found something');
    const top = cardTitled(view, 'Top searches');
    expect(text(top)).toContain('Searches in this period: 300.');
    expect(text(top)).not.toContain('No searches yet');
    expect(text(cardTitled(view, 'Searched again'))).toContain('Turn on search terms');
    // Only the notice carries the settings button; the lists point to it.
    expect(view.querySelectorAll('a[data-to="/app/projects/$projectId/settings"]')).toHaveLength(1);
    const footer = view.querySelector('[data-hidden-aggregate]');
    expect(text(footer as Element)).toBe('Hidden because search terms are off for this project: 7 terms across 9 searches.');
  });

  it('blames the private site, not rarity, for hidden terms', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('private_site')));
    const view = await render(<SearchSection />);
    const failed = cardTitled(view, 'Searches that failed');
    expect(text(failed)).toContain('This is a private site, so what readers typed is never stored.');
    expect(text(failed)).toContain('Searches with no results in this period: 6.');
    const footer = text(view.querySelector('[data-hidden-aggregate]') as Element);
    expect(footer).toBe('Hidden because this is a private site: 7 terms across 9 searches.');
    expect(footer).not.toContain('Rare terms');
  });

  it('names the visit threshold when visible terms are all too rare to list', async () => {
    mocks.search_.mockReturnValue(ready({ ...searchFixture(), topTerms: [], failedTerms: [], refinements: [] }));
    const view = await render(<SearchSection />);
    const failed = cardTitled(view, 'Searches that failed');
    expect(text(failed)).toContain('Searches with no results in this period: 6.');
    expect(text(failed)).toContain('fewer than 2 different visits');
    expect(text(failed)).not.toContain('Every search found something');
    expect(text(cardTitled(view, 'Top searches'))).toContain('fewer than 2 different visits');
    expect(text(cardTitled(view, 'Searched again'))).toContain('stay hidden for privacy');
    expect(text(view.querySelector('[data-hidden-aggregate]') as Element)).toContain('Rare terms hidden for privacy: 7 terms across 9 searches');
    expect(view.querySelector('a[data-to="/app/projects/$projectId/settings"]')).toBeNull();
  });

  it('says every search found something only when none came back empty', async () => {
    const data = searchFixture();
    mocks.search_.mockReturnValue(
      ready({
        ...data,
        failedTerms: [],
        kpis: { ...data.kpis, zeroResultRate: { value: 0, previous: 0 } },
        zeroResultSeries: data.zeroResultSeries.map((point) => ({ ...point, value: 0 })),
      }),
    );
    const view = await render(<SearchSection />);
    expect(text(cardTitled(view, 'Searches that failed'))).toContain('Every search found something in this period.');
  });

  it('turns search terms on in place after a confirm that says what is stored', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    const view = await render(<SearchSection />);
    const buttons = () => [...document.querySelectorAll('button')];
    const turnOn = buttons().find((button) => text(button) === 'Turn on search terms');
    expect(turnOn).toBeDefined();
    // Only the notice offers it; the lists below just point at the notice.
    expect(buttons().filter((button) => text(button) === 'Turn on search terms')).toHaveLength(1);
    await act(async () => turnOn?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(text(dialog as Element)).toContain('Turn on search terms?');
    expect(text(dialog as Element)).toContain('What readers type is deleted automatically after 30 days by default');
    expect(text(dialog as Element)).toContain('at least 2 different visits have searched for it');
    expect(text(dialog as Element)).toContain('Email addresses, web addresses and long numbers are removed');
    expect(mocks.updateConfig).not.toHaveBeenCalled();

    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => text(button) === 'Turn on');
    await act(async () => confirm?.click());
    expect(mocks.updateConfig).toHaveBeenCalledWith({ config: { analytics: { storePublicSearchTerms: true } } }, expect.any(Object));
    const options = mocks.updateConfig.mock.calls[0]?.[1] as { onSuccess: () => void };
    await act(async () => options.onSuccess());
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['analytics', 'insights', 'p1'] });
    expect(mocks.toast.success).toHaveBeenCalledWith('Search terms are on. New searches will appear here as readers make them.');
    // A secondary link still leads to the settings for turning it off later.
    expect(view.querySelector('a[data-to="/app/projects/$projectId/settings"]')).not.toBeNull();
  });

  it('explains a refused save politely inside the confirm', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    await render(<SearchSection />);
    const turnOn = [...document.querySelectorAll('button')].find((button) => text(button) === 'Turn on search terms');
    await act(async () => turnOn?.click());
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((button) => text(button) === 'Turn on');
    await act(async () => (confirm as HTMLButtonElement | undefined)?.click());
    const options = mocks.updateConfig.mock.calls[0]?.[1] as { onError: (error: unknown) => void };
    await act(async () => options.onError(Object.assign(new Error('Forbidden'), { status: 403 })));
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
      'Only project admins can turn on search terms. Ask an admin to turn it on for you.',
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('offers turning search terms on only to people who can change settings', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'u1' }, role: 'member' }] }, isPending: false, isError: false });
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    const view = await render(<SearchSection />);
    expect([...view.querySelectorAll('button')].some((button) => text(button) === 'Turn on search terms')).toBe(false);
    expect(view.querySelector('a[data-to="/app/projects/$projectId/settings"]')).toBeNull();
    expect(text(view)).toContain('A project admin can turn on search terms.');
  });

  it('offers the same switch from the overview when terms are off', async () => {
    mocks.overview.mockReturnValue(ready({ ...overviewFixture(), failedSearches: [], searchTermsVisibility: 'disabled_by_setting' }));
    const view = await render(<OverviewSection />);
    const card = cardTitled(view, "What can't they find?");
    expect([...card.querySelectorAll('button')].some((button) => text(button) === 'Turn on search terms')).toBe(true);
  });

  it('says private sites never store terms', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture('private_site')));
    const view = await render(<SearchSection />);
    expect(text(view)).toContain('never stored');
    expect(view.querySelector('a[data-to="/app/projects/$projectId/settings"]')).toBeNull();
    expect([...view.querySelectorAll('button')].some((button) => text(button) === 'Turn on search terms')).toBe(false);
  });
});

describe('Feedback, AI visibility and performance', () => {
  it.each(['en', 'ar'] as const)('shows drafting connections, totals, shares, and models in %s even without crawler traffic', async (locale) => {
    mocks.locale = locale;
    const data = aiFixture();
    data.bots = [];
    data.assistantReferrals = [];
    data.kpis.aiCrawlerRequests.value = 0;
    data.drafting = {
      total: 4,
      connections: [
        { connection: 'workspace', events: 3, share: 0.75, models: [['openai', 'fictional-model']] },
        { connection: 'instance', events: 1, share: 0.25, models: [['openrouter', 'fictional-fallback']] },
      ],
    };
    mocks.ai.mockReturnValue(ready(data));
    const view = await render(<AiSection />);
    expect(text(view)).toContain(locale === 'en' ? 'Workspace key' : 'مفتاح مساحة العمل');
    expect(text(view)).toContain(locale === 'en' ? 'Instance (Nibleaf) key' : 'مفتاح المثيل (Nibleaf)');
    expect(text(view)).toContain('openai / fictional-model');
    expect(text(view)).toContain('openrouter / fictional-fallback');
    const table = view.querySelector('table');
    const numberLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale;
    expect(table?.textContent).toContain(new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 1 }).format(0.75));
    expect(table?.textContent).toContain(new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 1 }).format(0.25));
    expect(text(view)).toContain(locale === 'en' ? 'Total events: 4' : 'إجمالي الأحداث: 4');
  });

  it('shows an empty drafting state and keeps unavailable totals unknown', async () => {
    mocks.ai.mockReturnValue(ready(aiFixture()));
    const empty = await render(<AiSection />);
    expect(text(empty)).toContain('No drafting events in this period.');
    mocks.ai.mockReturnValue(failed);
    const unavailable = await render(<AiSection />);
    expect(text(unavailable)).not.toContain('Total events: 0');
    expect(text(unavailable)).not.toContain('No drafting events in this period.');
  });

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

  it('drops the legacy AI answers card and ranks assistant referrals by visits', async () => {
    const data = aiFixture();
    mocks.ai.mockReturnValue(ready({ ...data, assistantReferrals: [...data.assistantReferrals].reverse() }));
    const view = await render(<AiSection />);
    expect(text(view)).not.toContain('AI answers and cost');
    expect(text(view)).not.toContain('No matching content');
    const referrals = text(cardTitled(view, 'Visits from AI assistants'));
    expect(referrals.indexOf('ChatGPT')).toBeLessThan(referrals.indexOf('Other assistants'));
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
    expect(text(view)).toContain('Analytics is taking a break');
  });
});

describe('First load', () => {
  type Shape = { tiles: number; charts: number; lists: number; tables: number[] };
  const firstLoad: Array<[string, () => void, () => ReactElement, Shape]> = [
    ['overview', () => mocks.overview.mockReturnValue(loading), () => <OverviewSection />, { tiles: 10, charts: 1, lists: 4, tables: [] }],
    ['pages', () => mocks.pages.mockReturnValue(loading), () => <PagesSection />, { tiles: 0, charts: 0, lists: 0, tables: [9] }],
    [
      'page drill-down',
      () => mocks.page.mockReturnValue(loading),
      () => <PagesSection path="getting-started" />,
      { tiles: 6, charts: 2, lists: 7, tables: [4] },
    ],
    ['search', () => mocks.search_.mockReturnValue(loading), () => <SearchSection />, { tiles: 6, charts: 1, lists: 0, tables: [5, 4, 2] }],
    ['feedback', () => mocks.feedback.mockReturnValue(loading), () => <FeedbackSection />, { tiles: 4, charts: 1, lists: 0, tables: [5] }],
    ['AI visibility', () => mocks.ai.mockReturnValue(loading), () => <AiSection />, { tiles: 4, charts: 2, lists: 3, tables: [3, 6, 4] }],
    [
      'performance',
      () => mocks.performance.mockReturnValue(loading),
      () => <PerformanceSection />,
      { tiles: 0, charts: 1, lists: 0, tables: [5, 5] },
    ],
  ];

  for (const [name, arrange, element, shape] of firstLoad) {
    it(`shows the ${name} section's shape while its first response loads`, async () => {
      arrange();
      const view = await render(element());
      // One busy region with one visually hidden status; the blocks themselves are hidden.
      const region = view.querySelector('[data-insights-region]');
      expect(region?.getAttribute('aria-busy')).toBe('true');
      const statuses = view.querySelectorAll('[role="status"]');
      expect(statuses).toHaveLength(1);
      expect(text(statuses[0] as Element)).toBe('Loading…');
      expect(statuses[0]?.className).toContain('sr-only');

      const tiles = [...view.querySelectorAll('[data-slot="skeleton-stat-tile"]')];
      expect(tiles).toHaveLength(shape.tiles);
      for (const tile of tiles) {
        // In the KPI grid, compact on phones like the real tile.
        expect(tile.parentElement?.className).toContain('min-[340px]:grid-cols-2');
        expect(tile.className).toContain('max-sm:p-3.5');
        expect(tile.getAttribute('aria-hidden')).toBe('true');
      }
      const charts = [...view.querySelectorAll('[data-chart-skeleton]')];
      expect(charts).toHaveLength(shape.charts);
      for (const chart of charts) {
        expect(chart.getAttribute('aria-hidden')).toBe('true');
        expect(chart.querySelector('[class*="h-[240px]"]')).not.toBeNull();
      }
      const lists = [...view.querySelectorAll('[data-list-skeleton]')];
      expect(lists).toHaveLength(shape.lists);
      for (const list of lists) expect(list.querySelectorAll('[data-slot="skeleton-list-row"]').length).toBeGreaterThan(0);

      // Placeholder rows sit inside the real tables, one cell per real column.
      const tables = [...view.querySelectorAll('table')];
      expect(tables.map((table) => table.querySelectorAll('thead th').length)).toEqual(shape.tables);
      for (const table of tables) {
        const columns = table.querySelectorAll('thead th').length;
        const rows = [...table.querySelectorAll('tbody tr')];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.getAttribute('data-slot')).toBe('skeleton-table-row');
          expect(row.querySelectorAll('td')).toHaveLength(columns);
        }
      }
      // No bare spinner on the page.
      expect(view.querySelector('.animate-spin')).toBeNull();
    });
  }

  it('drops the busy state and the skeletons once figures arrive', async () => {
    mocks.overview.mockReturnValue(ready(overviewFixture()));
    const view = await render(<OverviewSection />);
    expect(view.querySelector('[data-insights-region]')?.getAttribute('aria-busy')).toBeNull();
    expect(text(view.querySelector('[role="status"]') as Element)).toBe('');
    expect(view.querySelector('[data-slot^="skeleton"]')).toBeNull();
  });

  it('keeps the shown range on screen while the next one loads', async () => {
    // keepPreviousData: the next range is pending, but the hook still returns the previous data.
    mocks.overview.mockReturnValue({ ...ready(overviewFixture()), isFetching: true, isPlaceholderData: true });
    const view = await render(<OverviewSection />);
    expect(text(view)).toContain('1,240');
    expect(view.querySelector('[data-slot^="skeleton"]')).toBeNull();
    expect(view.querySelector('[data-insights-region]')?.getAttribute('aria-busy')).toBeNull();
  });

  it('disables the pages filter while the table shape loads', async () => {
    mocks.pages.mockReturnValue(loading);
    const view = await render(<PagesSection />);
    expect(view.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(true);
    expect(text(view)).not.toMatch(/\d+ pages?/);
  });
});

describe('Async buttons', () => {
  it('shows "Write an article for this" as loading while the draft is created', async () => {
    mocks.createPending = true;
    mocks.search_.mockReturnValue(ready(searchFixture()));
    const view = await render(<SearchSection />);
    const write = view.querySelector<HTMLButtonElement>('button[aria-label="Write an article for “webhooks”"]');
    expect(write?.getAttribute('aria-busy')).toBe('true');
    expect(write?.disabled).toBe(true);
    expect(write?.hasAttribute('data-loading')).toBe(true);
    // The label keeps its place (and the button its width).
    expect(text(write as Element)).toContain('Write an article for this');
    await act(async () => write?.click());
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('reports a failed draft in plain words, never the server message', async () => {
    mocks.search_.mockReturnValue(ready(searchFixture()));
    const view = await render(<SearchSection />);
    await act(async () => view.querySelector<HTMLButtonElement>('button[aria-label="Write an article for “webhooks”"]')?.click());
    const options = mocks.mutate.mock.calls[0]?.[1] as { onError: (error: unknown) => void; onSettled: () => void };
    await act(async () => {
      options.onError(new Error('P2002 unique constraint failed on slug'));
      options.onSettled();
    });
    expect(mocks.toast.error).toHaveBeenCalledOnce();
    expect(String(mocks.toast.error.mock.calls[0]?.[0])).not.toContain('P2002');
  });

  it('shows "Turn on" as loading and holds Cancel while the setting saves', async () => {
    mocks.updatePending = true;
    mocks.search_.mockReturnValue(ready(searchFixture('disabled_by_setting')));
    await render(<SearchSection />);
    const turnOn = [...document.querySelectorAll('button')].find((button) => text(button) === 'Turn on search terms');
    await act(async () => turnOn?.click());
    const dialogButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    const confirm = dialogButtons.find((button) => text(button) === 'Turn on');
    expect(confirm?.getAttribute('aria-busy')).toBe('true');
    expect(confirm?.disabled).toBe(true);
    expect(dialogButtons.find((button) => text(button) === 'Cancel')?.disabled).toBe(true);
    await act(async () => confirm?.click());
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
});

describe('Filter bar', () => {
  it('switches presets and comparison through the URL owner', async () => {
    const onChange = vi.fn();
    const view = await render(<InsightsFilterBar filters={{}} onChange={onChange} timezone="Asia/Riyadh" />);
    expect(text(view)).toContain('Times shown in Asia/Riyadh');
    await act(async () => view.querySelectorAll<HTMLElement>('[role="group"] button')[1]?.click());
    expect(onChange).toHaveBeenLastCalledWith({ range: '7d' });
    await act(async () => view.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(onChange).toHaveBeenLastCalledWith({ compare: 'none' });
  });

  it('marks no preset as active for a custom range', async () => {
    const view = await render(
      <InsightsFilterBar filters={{ range: 'custom', from: '2026-10-01', to: '2026-10-31' }} onChange={vi.fn()} timezone="UTC" />,
    );
    expect([...view.querySelectorAll('[role="group"] button')].every((tab) => tab.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(view.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Oct');
  });
});
