// @vitest-environment jsdom

import { resolveTheme, THEME_PRESETS } from '@nibleaf/shared/themes';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { ThemeSection } from './theme-section';

/** Option labels are deliberately distinct from the raw option ids so a trigger
 *  that shows the id instead of the label is caught. */
const OPTION_IDS = [
  'reference',
  'editorial',
  'console',
  'compact',
  'comfortable',
  'relaxed',
  'focused',
  'balanced',
  'wide',
  'inline',
  'stacked',
  'floating',
  'bordered',
  'soft',
  'rail',
  'tree',
  'sectioned',
  'sharp',
  'rounded',
  'pill',
  'system',
  'dim',
  'vivid',
  'outline',
  'solid',
  'lifted',
  'flat',
  'underline',
  'pills',
  'boxed',
  'lines',
  'rows',
  'cards',
];
const translations: Record<string, string> = Object.fromEntries(OPTION_IDS.map((id) => [`settings.theme.option.${id}`, `تسمية ${id}`]));

const mutation = { isPending: false, mutate: vi.fn() };

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string) => translations[key] ?? key,
  translateFn: (key: string) => key,
}));
vi.mock('@/hooks/api', () => ({
  useUpdateProjectConfig: () => mutation,
  useImportProjectTheme: () => mutation,
  useExportProjectTheme: () => mutation,
}));
vi.mock('@/lib/site-theme', () => ({ projectThemeVariables: () => ({}), projectThemeStyle: () => ({}) }));
vi.mock('@/components/site/documentation-theme-provider', () => ({
  DocumentationThemeProvider: ({
    children,
    theme,
    direction,
  }: {
    children: ReactNode;
    theme: { id: string; layout: { shell: string } };
    direction: string;
  }) => (
    <div data-preset={theme.id} data-shell={theme.layout.shell} data-testid="preview" dir={direction}>
      {children}
    </div>
  ),
  DocumentationStudioPreviewLayout: ({ header, navigation, content }: Record<'header' | 'navigation' | 'content', ReactNode>) => (
    <div>
      {header}
      {navigation}
      {content}
    </div>
  ),
}));

const project: Project = {
  id: 'project-a',
  organizationId: 'org-a',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const preview = () => document.querySelector<HTMLElement>('[data-testid="preview"]');
const triggers = () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-trigger"]')];
const triggerLabel = (trigger: HTMLElement) => trigger.querySelector('[data-slot="select-value"]')?.textContent;

describe('ThemeSection controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    container.dir = 'rtl';
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ThemeSection project={project} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders every layout and component option as a design-system select showing the translated label', () => {
    expect(container.querySelector('select')).toBeNull();
    const resolved = resolveTheme(null);
    const labels = triggers().map(triggerLabel);
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe(translations[`settings.theme.option.${resolved.layout.shell}`]);
    expect(labels[7]).toBe(translations[`settings.theme.option.${resolved.components.codeBlocks}`]);
    for (const label of labels) {
      expect(label).toMatch(/^تسمية /);
    }
    // Every trigger is labelled for assistive tech through its visible label.
    for (const trigger of triggers()) {
      const id = trigger.getAttribute('id');
      expect(id).toBeTruthy();
      expect(container.querySelector(`label[for="${id}"]`)?.textContent).toBeTruthy();
    }
  });

  it('updates the preview when an option is picked from the select', async () => {
    const [shell] = triggers();
    if (!shell) throw new Error('missing shell select');
    expect(preview()?.dataset.shell).toBe(resolveTheme(null).layout.shell);

    await act(async () => {
      shell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      shell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      shell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      shell.click();
    });
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.includes('console'));
    if (!option) throw new Error('select popup did not open');
    await act(async () => {
      option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      option.click();
    });

    expect(preview()?.dataset.shell).toBe('console');
    expect(triggerLabel(triggers()[0] as HTMLElement)).toBe(translations['settings.theme.option.console']);
  });

  it('switches the preview to a preset and to Arabic without native controls', async () => {
    const gallery = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    expect(gallery).toHaveLength(3);
    const signal = gallery[2];
    if (!signal) throw new Error('missing preset button');
    await act(async () => signal.click());
    expect(preview()?.dataset.preset).toBe('signal');
    expect(preview()?.dataset.shell).toBe(THEME_PRESETS.signal.layout.shell);

    const toggle = container.querySelector<HTMLButtonElement>('button[lang="ar"]');
    if (!toggle) throw new Error('missing preview language toggle');
    expect(toggle.getAttribute('dir')).toBe('rtl');
    expect(preview()?.getAttribute('dir')).toBe('ltr');
    await act(async () => toggle.click());
    expect(preview()?.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('button[lang="en"]')?.getAttribute('dir')).toBe('ltr');
  });

  it('keeps code-like values left-to-right inside the RTL form', () => {
    const hexes = [...container.querySelectorAll<HTMLElement>('code[dir="ltr"]')];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect(hex.textContent).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(container.querySelector('textarea')?.getAttribute('dir')).toBe('ltr');
  });
});
