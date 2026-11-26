// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider, SectionHeader, useSectionScope } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { type AppearanceHost, AppearancePage } from './appearance-page';

const mocks = vi.hoisted(() => ({ updateProject: vi.fn(), locale: 'en' }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ t: (key: string) => key, locale: mocks.locale }),
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => fallback }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/lib/site-theme', () => ({ projectThemeVariables: () => ({}), projectThemeStyle: () => ({}) }));
vi.mock('@/components/site/documentation-theme-provider', () => ({
  DocumentationThemeProvider: ({
    children,
    theme,
    direction,
  }: {
    children: unknown;
    theme: { id: string; layout: { radius: string } };
    direction: string;
  }) => (
    <div data-preset={theme.id} data-radius={theme.layout.radius} data-testid="preview" dir={direction}>
      {children as never}
    </div>
  ),
  DocumentationStudioPreviewLayout: () => null,
}));

/** Sections with their own data and tests: here only where they sit and how they are headed. */
function stub(title: string) {
  return function Stub() {
    return <SectionHeader icon={null} title={title} />;
  };
}
vi.mock('@/features/site-branding/components/branding-settings', () => ({
  BrandingSettings() {
    const { headingLevel, chrome } = useSectionScope();
    const Heading = `h${headingLevel}` as const;
    return (
      <div data-chrome={chrome} data-testid="branding">
        <Heading>settings.branding.title</Heading>
      </div>
    );
  },
}));
vi.mock('@/features/site-theme/components/theme-settings', () => ({ ThemeSettings: stub('settings.theme.title') }));
vi.mock('@/features/site-navbar/components/navbar-settings', () => ({ NavbarSettings: stub('settings.navbar.title') }));
vi.mock('@/features/site-footer/components/footer-settings', () => ({ FooterSettings: stub('settings.footer.title') }));
vi.mock('@/features/site-banner/components/banner-settings', () => ({ BannerSettings: stub('settings.banner.title') }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const site = (config: Record<string, unknown> = {}) =>
  ({ id: 'site-a', name: 'Handbook', config: { theme: { version: 1, preset: 'signal' }, ...config } }) as unknown as Project;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Map<string, boolean>;

const render = (project: Project, host: AppearanceHost = 'settings', initialGroup?: 'chrome') =>
  act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ConfigDirtyProvider report={(source, value) => dirty.set(source, value)}>
          <AppearancePage host={host} initialGroup={initialGroup} project={project} />
        </ConfigDirtyProvider>
      </QueryClientProvider>,
    ),
  );

const bars = () => container.querySelectorAll('[data-slot="save-region"]');
const button = (name: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((el) => !el.hidden && el.textContent?.trim().startsWith(name));
const previews = () => [...container.querySelectorAll<HTMLElement>('[data-testid="preview"]')];
/** The radius group of Styling: its segmented buttons. */
const radiusButton = (option: 'sharp' | 'rounded' | 'pill') => button(`settings.styling.radius.${option}`) as HTMLButtonElement;
/** Typography's rhythm: the base size's segmented buttons. */
const sizeButton = (size: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[data-slot="segmented-control-item"]')].find(
    (el) => el.textContent === size,
  ) as HTMLButtonElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Map();
  mocks.locale = 'en';
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
  mocks.updateProject.mockImplementation(async ({ config }: { config: Record<string, unknown> }) => site(config));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

describe('Appearance as one page', () => {
  it('shows the four parts in order under one page heading, grouped sections a level below', async () => {
    await render(site());
    // Previews are samples, not headings of this page (§5.5).
    const headings = [...container.querySelectorAll('h1, h2, h3')]
      .filter((el) => el.getAttribute('role') !== 'presentation')
      .map((el) => `${el.tagName} ${el.textContent}`);
    expect(headings).toEqual([
      'H1 settings.tab.appearance',
      'H2 settings.branding.title',
      'H2 settings.appearance.group.theme',
      'H3 settings.styling.title',
      'H3 settings.theme.title',
      'H2 settings.typography.title',
      'H2 settings.appearance.group.chrome',
      'H3 settings.navbar.title',
      'H3 settings.footer.title',
      'H3 settings.banner.title',
      'H2 settings.appearance.preview.title',
    ]);
    expect([...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))).toEqual([
      '#appearance-brand',
      '#appearance-theme',
      '#appearance-typography',
      '#appearance-chrome',
    ]);
    for (const id of ['brand', 'theme', 'typography', 'chrome']) expect(container.querySelector(`#appearance-${id}`)).not.toBeNull();
  });

  it('has one save bar for every form on the page; Save stores each changed section', async () => {
    await render(site({ styling: { primaryColor: '#5546e8' }, typography: { baseSize: '16' } }));
    expect(bars()).toHaveLength(0);
    await act(async () => radiusButton('pill').click());
    await act(async () => sizeButton('18').click());
    expect(bars()).toHaveLength(1);
    expect([...dirty.values()].some(Boolean)).toBe(true);
    await act(async () => button('common.save', bars()[0] as HTMLElement)?.click());
    await vi.waitFor(() => expect(mocks.updateProject).toHaveBeenCalledTimes(2));
    const sent = mocks.updateProject.mock.calls.map(([body]) => body.config);
    expect(sent).toContainEqual({ styling: { radius: 'pill' } });
    expect(sent).toContainEqual({ typography: { baseSize: '18' } });
    expect(sent).toHaveLength(2);
  });

  it('previews an unsaved change before Save, and goes back to what is stored on Discard', async () => {
    await render(site({ styling: { radius: 'rounded' } }));
    expect(previews().map((preview) => preview.dataset.radius)).toEqual(['rounded']);
    await act(async () => radiusButton('pill').click());
    expect(previews().map((preview) => preview.dataset.radius)).toEqual(['pill']);
    expect(mocks.updateProject).not.toHaveBeenCalled();
    await act(async () => button('forms.discard', bars()[0] as HTMLElement)?.click());
    expect(previews().map((preview) => preview.dataset.radius)).toEqual(['rounded']);
  });

  it('opens the preview in Arabic while the dashboard is in Arabic, with English one click away', async () => {
    mocks.locale = 'ar';
    await render(site());
    expect(previews()[0]?.getAttribute('dir')).toBe('rtl');
    const english = container.querySelector<HTMLButtonElement>('[data-live-preview] button[lang="en"]');
    await act(async () => english?.click());
    expect(previews()[0]?.getAttribute('dir')).toBe('ltr');
  });

  it('offers the preview in a sheet below the two-column width, with the same drafts', async () => {
    await render(site({ styling: { radius: 'rounded' } }));
    await act(async () => radiusButton('sharp').click());
    await act(async () => button('project.preview')?.click());
    const sheet = document.querySelector('[data-slot="sheet-content"]');
    expect(sheet?.textContent).toContain('settings.appearance.preview.title');
    expect(sheet?.querySelector<HTMLElement>('[data-testid="preview"]')?.dataset.radius).toBe('sharp');
  });

  it('in the editor, renders plain panels', async () => {
    await render(site(), 'editor');
    expect(container.querySelector('[data-appearance-host="editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="branding"]')?.getAttribute('data-chrome')).toBe('plain');
    const panels = [...container.querySelectorAll('[data-slot="settings-section-panel"]')];
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) expect(panel.className).not.toContain('border-border bg-card');
  });

  it('opens an old tab link at the part that holds it now', async () => {
    await render(site(), 'settings', 'chrome');
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts as Element[];
    expect(scrolled.map((el) => el.id)).toContain('appearance-chrome');
  });
});
