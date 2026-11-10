// @vitest-environment jsdom

import { PageContainer } from '@nibleaf/design-system/components/ui/page-container';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SaveRegion } from '@nibleaf/design-system/components/ui/save-region';
import { describedBy, SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--save-region-h');
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return {
    container,
    rerender: (next: ReactElement) => act(async () => root.render(next)),
  };
}

const byId = (id: string | null | undefined) => (id ? document.getElementById(id) : null);
const describedText = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => byId(id)?.textContent);

describe('PageHeader', () => {
  it('renders the page title as an h1 with its description and actions', async () => {
    const { container } = await render(
      <PageHeader title="General" description="Name and address" actions={<button type="button">Open site</button>} />,
    );
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('General');
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(container.textContent).toContain('Name and address');
    expect(container.querySelector('button')?.textContent).toBe('Open site');
  });

  it('takes a lower heading level when embedded in another page', async () => {
    const { container } = await render(<PageHeader headingLevel={2} title="Branding" />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Branding');
  });
});

describe('PageContainer', () => {
  it('constrains the column by width preset and never centres it', async () => {
    const { container } = await render(
      <PageContainer width="wide">
        <p>content</p>
      </PageContainer>,
    );
    const column = container.querySelector('[data-slot="page-container"] > div');
    expect(column?.className).toContain('max-w-[65rem]');
    expect(column?.className).toContain('me-auto');
    expect(column?.className).not.toContain('mx-auto');
  });
});

describe('SettingsSection', () => {
  it('renders a heading over one panel and is not a landmark', async () => {
    const { container } = await render(
      <SettingsSection title="Site" description="How readers find it">
        <SettingsSectionBody>Body</SettingsSectionBody>
      </SettingsSection>,
    );
    const section = container.querySelector('section');
    expect(section?.querySelector('h2')?.textContent).toBe('Site');
    expect(section?.hasAttribute('aria-labelledby')).toBe(false);
    expect(container.querySelectorAll('[data-slot="settings-section-panel"]')).toHaveLength(1);
  });

  it('marks the danger tone and drops the border in plain chrome', async () => {
    const { container } = await render(
      <SettingsSection chrome="plain" title="Danger zone" tone="destructive">
        <SettingsSectionBody>Delete</SettingsSectionBody>
      </SettingsSection>,
    );
    expect(container.querySelector('section')?.dataset.tone).toBe('destructive');
    expect(container.querySelector('[data-slot="settings-section-panel"]')?.className).not.toContain('border-border');
  });
});

describe('SettingsRow', () => {
  it('labels a single control and describes it with description, reason and error in order', async () => {
    const { container } = await render(
      <SettingsRow description="Shown in the browser tab" disabledReason="Only Admins can rename the site" error="Required" label="Name">
        {(ids) => <input {...ids.controlProps} />}
      </SettingsRow>,
    );
    const input = container.querySelector('input');
    const label = container.querySelector('label');
    expect(input).not.toBeNull();
    expect(label?.htmlFor).toBe(input?.id);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(input as Element)).toEqual(['Shown in the browser tab', 'Only Admins can rename the site', 'Required']);
  });

  it('describes nothing extra when there is no description, reason or error', async () => {
    const { container } = await render(<SettingsRow label="Name">{(ids) => <input {...ids.controlProps} />}</SettingsRow>);
    const input = container.querySelector('input');
    expect(input?.hasAttribute('aria-describedby')).toBe(false);
    expect(input?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('labels a group of controls with role="group" instead of a <label>', async () => {
    const { container } = await render(
      <SettingsRow asGroup description="Pick one" label="Theme">
        {(ids) => (
          <div {...ids.controlProps}>
            <button type="button">Light</button>
            <button type="button">Dark</button>
          </div>
        )}
      </SettingsRow>,
    );
    const group = container.querySelector('[role="group"]');
    expect(container.querySelector('label')).toBeNull();
    expect(byId(group?.getAttribute('aria-labelledby'))?.textContent).toBe('Theme');
    expect(describedText(group as Element)).toEqual(['Pick one']);
  });

  it('uses the caller-provided control id and error id', async () => {
    const { container } = await render(
      <SettingsRow error="Taken" errorId="slug-error" htmlFor="slug" label="Address">
        {(ids) => <input {...ids.controlProps} />}
      </SettingsRow>,
    );
    const input = container.querySelector('input');
    expect(input?.id).toBe('slug');
    expect(container.querySelector('label')?.htmlFor).toBe('slug');
    expect(input?.getAttribute('aria-describedby')).toBe('slug-error');
  });

  it('keeps switches on the label line instead of stacking them', async () => {
    const { container } = await render(
      <SettingsRow control="switch" label="Show feedback">
        <span />
      </SettingsRow>,
    );
    expect(container.querySelector('[data-slot="settings-row"] > div')?.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
  });

  it('describedBy drops blanks and duplicates and keeps order', () => {
    expect(describedBy('a', undefined, 'b a', false, 'c')).toBe('a b c');
    expect(describedBy(undefined, null)).toBeUndefined();
  });
});

describe('SaveRegion', () => {
  const props = {
    discardLabel: 'Discard',
    label: 'Unsaved changes',
    message: 'Unsaved changes',
    onDiscard: () => undefined,
    onSave: () => undefined,
    saveLabel: 'Save',
  };

  it('renders nothing visible while closed but keeps its live region mounted', async () => {
    const { container } = await render(<SaveRegion {...props} open={false} status="Saved" />);
    expect(container.querySelector('[data-slot="save-region"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('shows a named region with Save and Discard, and calls them', async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const { container } = await render(<SaveRegion {...props} onDiscard={onDiscard} onSave={onSave} open />);
    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Unsaved changes');
    const [discard, save] = Array.from(region?.querySelectorAll('button') ?? []);
    await act(async () => discard?.click());
    await act(async () => save?.click());
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('blocks Discard and a second Save while saving', async () => {
    const onSave = vi.fn();
    const { container } = await render(<SaveRegion {...props} onSave={onSave} open saving />);
    const [discard, save] = Array.from(container.querySelectorAll('[role="region"] button')) as HTMLButtonElement[];
    expect(discard?.disabled).toBe(true);
    expect(save?.getAttribute('aria-busy')).toBe('true');
    await act(async () => save?.click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('publishes its height while floating and clears it when it hides', async () => {
    const { rerender } = await render(<SaveRegion {...props} open />);
    expect(document.documentElement.style.getPropertyValue('--save-region-h')).toMatch(/px$/);
    await rerender(<SaveRegion {...props} open={false} />);
    expect(document.documentElement.style.getPropertyValue('--save-region-h')).toBe('');
  });

  it('does not publish a height while docked in the form', async () => {
    await render(<SaveRegion {...props} docked open />);
    expect(document.documentElement.style.getPropertyValue('--save-region-h')).toBe('');
  });

  it('moves focus to the page h1 when it hides with focus on its buttons', async () => {
    const page = (open: boolean) => (
      <div>
        <h1 tabIndex={-1}>General</h1>
        <SaveRegion {...props} open={open} />
      </div>
    );
    const { container, rerender } = await render(page(true));
    const save = [...container.querySelectorAll<HTMLButtonElement>('[role="region"] button')].at(-1);
    await act(async () => save?.focus());
    expect(document.activeElement).toBe(save);
    await rerender(page(false));
    expect(document.activeElement).toBe(container.querySelector('h1'));
  });

  it('leaves focus alone when it hides while focus is elsewhere', async () => {
    const page = (open: boolean) => (
      <div>
        <h1 tabIndex={-1}>General</h1>
        <input aria-label="Name" />
        <SaveRegion {...props} open={open} />
      </div>
    );
    const { container, rerender } = await render(page(true));
    const save = [...container.querySelectorAll<HTMLButtonElement>('[role="region"] button')].at(-1);
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => save?.focus());
    await act(async () => input.focus());
    await rerender(page(false));
    expect(document.activeElement).toBe(input);
  });

  it('uses returnFocusTo when given', async () => {
    const target = document.createElement('button');
    target.textContent = 'Name field';
    document.body.append(target);
    const page = (open: boolean) => <SaveRegion {...props} open={open} returnFocusTo={() => target} />;
    const { container, rerender } = await render(page(true));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="region"] button')?.focus());
    await rerender(page(false));
    expect(document.activeElement).toBe(target);
  });
});
