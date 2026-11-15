// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { TypographySettings } from './typography-settings';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Typography = Record<'headingFont' | 'bodyFont' | 'codeFont' | 'baseSize' | 'leading' | 'flow', string>;
/** Saved with the Compact preset's rhythm and a heading font outside the catalog. */
const SAVED: Typography = { headingFont: 'Merriweather', bodyFont: 'Inter', codeFont: 'Fira Code', baseSize: '15', leading: '1.6', flow: '1' };
/** A site as the project query returns it; other config sections ride along untouched. */
const site = (typography: Partial<Typography> = SAVED, id = 'site-a') =>
  ({ id, config: { theme: { preset: 'nib' }, branding: { favicon: '/favicon.svg' }, typography } }) as unknown as Project;
/** The project the PATCH returns: the stored typography merged one level deep with the patch, as the API does. */
const merged = (patch: Partial<Typography>, stored: Partial<Typography> = SAVED, id = 'site-a') => site({ ...stored, ...patch }, id);

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <TypographySettings project={project} />
      </ConfigDirtyProvider>,
    ),
  );

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  await render(site());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const FONT = {
  headingFont: 'settings.typography.headingFont.label',
  bodyFont: 'settings.typography.bodyFont.label',
  codeFont: 'settings.typography.codeFont.label',
};
const GROUP = {
  preset: 'settings.typography.preset.label',
  baseSize: 'settings.typography.baseSize.label',
  leading: 'settings.typography.leading.label',
  flow: 'settings.typography.flow.label',
};
const FLOW_STEP: Record<string, string> = {
  '0.75': 'settings.typography.flow.tight',
  '1': 'settings.typography.flow.snug',
  '1.25': 'settings.typography.flow.normal',
  '1.5': 'settings.typography.flow.roomy',
  '2': 'settings.typography.flow.airy',
};

const fontTrigger = (name: keyof typeof FONT) => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === FONT[name]);
  const control = label ? document.getElementById(label.htmlFor) : null;
  if (!control) throw new Error(`No control for ${name}`);
  return control;
};
const group = (name: keyof typeof GROUP) => {
  const found = [...container.querySelectorAll('[role="group"]')].find(
    (el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent === GROUP[name],
  );
  if (!found) throw new Error(`No group named ${name}`);
  return found as HTMLElement;
};
const buttons = (name: keyof typeof GROUP) => [...group(name).querySelectorAll('button')];
const pressed = (name: keyof typeof GROUP) =>
  buttons(name)
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);
const stepText = (name: 'baseSize' | 'leading' | 'flow', step: string) =>
  name === 'flow' ? FLOW_STEP[step] : name === 'leading' && step === '2' ? '2.0' : step;
const fontValue = (name: keyof typeof FONT) => fontTrigger(name).querySelector('[data-slot="select-value"]')?.textContent;
/** What the form shows: each font picker's value and each rhythm row's pressed step. */
const shown = () => ({
  headingFont: fontValue('headingFont'),
  bodyFont: fontValue('bodyFont'),
  codeFont: fontValue('codeFont'),
  baseSize: pressed('baseSize')[0],
  leading: pressed('leading')[0],
  flow: pressed('flow')[0],
});
const showing = (typography: Typography) => ({
  ...typography,
  baseSize: stepText('baseSize', typography.baseSize),
  leading: stepText('leading', typography.leading),
  flow: stepText('flow', typography.flow),
});
const preview = () => container.querySelector<HTMLElement>('.typeset') as HTMLElement;
const previewVars = () => ({
  fontSize: preview().style.fontSize,
  leading: preview().style.getPropertyValue('--typeset-leading'),
  flow: preview().style.getPropertyValue('--typeset-flow'),
  heading: preview().style.getPropertyValue('--typeset-font-heading'),
});

const click = (el: HTMLElement) => act(async () => el.click());
const choose = (name: 'baseSize' | 'leading' | 'flow', step: string) => {
  const button = buttons(name).find((b) => b.textContent === stepText(name, step));
  if (!button) throw new Error(`No ${step} in ${name}`);
  return click(button);
};
const preset = (name: 'default' | 'compact' | 'relaxed' | 'article') => {
  const button = buttons('preset').find((b) => b.textContent === `settings.typography.preset.${name}`);
  if (!button) throw new Error(`No preset ${name}`);
  return click(button);
};
/** Opens a font picker and picks `font`, as a pointer user would. */
const pickFont = async (name: keyof typeof FONT, font: string) => {
  await click(fontTrigger(name));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.textContent === font);
  if (!option) throw new Error(`No option ${font} for ${name}`);
  await click(option);
};
const region = () => container.querySelector('[data-slot="save-region"]');
const regionButton = (name: string) => {
  const button = [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(name));
  if (!button) throw new Error(`No ${name} button in the save bar`);
  return button;
};
const save = () => click(regionButton('common.save'));
const discard = () => click(regionButton('forms.discard'));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TypographySettings: the draft', () => {
  it('opens pristine on all six saved values, a custom font included, every control named, no save bar', () => {
    expect(container.querySelector('h2')?.textContent).toBe('settings.typography.title');
    expect(shown()).toEqual(showing(SAVED));
    for (const name of Object.keys(FONT) as Array<keyof typeof FONT>) {
      expect(document.getElementById(fontTrigger(name).getAttribute('aria-labelledby') ?? '')?.textContent).toBe(FONT[name]);
    }
    for (const name of Object.keys(GROUP) as Array<keyof typeof GROUP>) expect(buttons(name).length).toBeGreaterThan(0);
    expect(pressed('preset')).toEqual(['settings.typography.preset.compact']);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('opens a site that never set typography on the defaults, with the Default preset pressed', async () => {
    await render(site({}, 'site-b'));
    expect(shown()).toEqual(
      showing({ headingFont: 'Geist', bodyFont: 'Geist', codeFont: 'Geist Mono', baseSize: '16', leading: '1.75', flow: '1.25' }),
    );
    expect(pressed('preset')).toEqual(['settings.typography.preset.default']);
    expect(region()).toBeNull();
  });

  it('a preset changes only the rhythm triple, in the draft; nothing is saved', async () => {
    await preset('article');
    expect(shown()).toEqual(showing({ ...SAVED, baseSize: '17', leading: '2', flow: '1.5' }));
    expect(pressed('preset')).toEqual(['settings.typography.preset.article']);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
  });

  it('a single edit clears the pressed preset, and lands on another preset when it matches', async () => {
    await preset('relaxed');
    await choose('leading', '2');
    expect(pressed('preset')).toEqual([]);
    await choose('leading', '1.75');
    await choose('flow', '1.25');
    expect(pressed('preset')).toEqual(['settings.typography.preset.default']);
  });

  it('is dirty on any of the six values and discards all of them back to the saved ones', async () => {
    await pickFont('bodyFont', 'Source Sans 3');
    await preset('relaxed');
    expect(shown()).toEqual(showing({ ...SAVED, bodyFont: 'Source Sans 3', baseSize: '16', leading: '1.9', flow: '1.5' }));
    await discard();
    expect(shown()).toEqual(showing(SAVED));
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    // Back on the saved values by hand is clean too.
    await choose('baseSize', '18');
    await choose('baseSize', '15');
    expect(region()).toBeNull();
  });

  it("keeps the site's own font in its picker after another is picked, so going back is clean", async () => {
    await pickFont('headingFont', 'Inter');
    expect(region()).not.toBeNull();
    await pickFont('headingFont', 'Merriweather');
    expect(shown()).toEqual(showing(SAVED));
    expect(region()).toBeNull();
  });

  it('saves only what changed as a config.typography patch, then is clean on the server-confirmed values', async () => {
    await pickFont('codeFont', 'JetBrains Mono');
    await preset('article');
    const patch = { codeFont: 'JetBrains Mono', baseSize: '17', leading: '2', flow: '1.5' };
    mocks.update.mockResolvedValueOnce(merged(patch));
    await save();
    // No preset name and no other config section: the API merges this one section one level deep.
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ config: { typography: patch } });
    expect(shown()).toEqual(showing({ ...SAVED, ...patch }));
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('keeps the edits and says why once when the save fails', async () => {
    await preset('relaxed');
    await pickFont('headingFont', 'Inter');
    mocks.update.mockRejectedValueOnce(new Error('offline'));
    await save();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('friendly:settings.saveError');
    expect(shown()).toEqual(showing({ ...SAVED, headingFont: 'Inter', baseSize: '16', leading: '1.9', flow: '1.5' }));
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
  });

  it('takes a refetch of all six values while clean', async () => {
    const theirs: Typography = { headingFont: 'Söhne', bodyFont: 'System UI', codeFont: 'IBM Plex Mono', baseSize: '18', leading: '1.5', flow: '2' };
    await render(site(theirs));
    expect(shown()).toEqual(showing(theirs));
    expect(region()).toBeNull();
  });

  it('keeps an edit through a refetch, takes the untouched values, and offers the conflict on the same value', async () => {
    await choose('leading', '1.9');
    await render(site({ ...SAVED, codeFont: 'IBM Plex Mono', flow: '2' }));
    expect(shown()).toEqual(showing({ ...SAVED, leading: '1.9', codeFont: 'IBM Plex Mono', flow: '2' }));
    expect(container.textContent).not.toContain('forms.changedElsewhere');
    await render(site({ ...SAVED, codeFont: 'IBM Plex Mono', flow: '2', leading: '2' }));
    expect(container.textContent).toContain('forms.changedElsewhere');
  });

  it('never sends back a rhythm value someone else changed since the form opened', async () => {
    // Another tab saves a new line height while this form is open and clean…
    await render(site({ ...SAVED, leading: '1.9' }));
    // …then the person changes the base size (found by its text alone, so this runs on main's form too) and saves.
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === '17') as HTMLElement);
    mocks.update.mockResolvedValueOnce(merged({ baseSize: '17' }, { ...SAVED, leading: '1.9' }));
    await save();
    // The patch holds the base size alone: no stale copy of the old line height (or anything else) rides along.
    expect(mocks.update.mock.calls[0]?.[0]?.config?.typography).toEqual({ baseSize: '17' });
    expect(pressed('leading')).toEqual(['1.9']);
  });

  it('the live preview follows the draft: presets, single edits, fonts and discard', async () => {
    expect(previewVars()).toEqual({ fontSize: '15px', leading: '1.6', flow: '1em', heading: "'Merriweather', var(--font-sans, sans-serif)" });
    await preset('article');
    expect(previewVars()).toMatchObject({ fontSize: '17px', leading: '2', flow: '1.5em' });
    await choose('flow', '0.75');
    await pickFont('headingFont', 'IBM Plex Sans');
    expect(previewVars()).toEqual({ fontSize: '17px', leading: '2', flow: '0.75em', heading: "'IBM Plex Sans', var(--font-sans, sans-serif)" });
    expect(mocks.update).not.toHaveBeenCalled();
    await discard();
    expect(previewVars()).toMatchObject({ fontSize: '15px', leading: '1.6', flow: '1em' });
  });

  it("opens another site on its own values, and the first site's late save says nothing there", async () => {
    const request = deferred<Project>();
    mocks.update.mockReturnValueOnce(request.promise);
    await preset('article');
    await save();
    const other: Typography = { ...SAVED, headingFont: 'Geist', baseSize: '18' };
    await render(site(other, 'site-b'));
    expect(shown()).toEqual(showing(other));
    await act(async () => request.reject(new Error('late')));
    expect(shown()).toEqual(showing(other));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });

  describe("a save's own refetch, which the config mutation awaits before it resolves", () => {
    /** Saves line height 1.9 over 1.6, picks `newer` while the save runs, then delivers the save's own refetch. */
    const saveThenEditThenRefetch = async (newer: string) => {
      const request = deferred<Project>();
      mocks.update.mockReturnValueOnce(request.promise);
      await choose('leading', '1.9');
      await save();
      await choose('leading', newer);
      await render(site({ ...SAVED, leading: '1.9' }));
      expect(pressed('leading')).toEqual([stepText('leading', newer)]);
      await act(async () => request.resolve(site({ ...SAVED, leading: '1.9' })));
    };

    it('keeps a value set back to the old one during the save, dirty, and saves it next', async () => {
      await saveThenEditThenRefetch('1.6');
      expect(mocks.update).toHaveBeenCalledWith({ config: { typography: { leading: '1.9' } } });
      expect(pressed('leading')).toEqual(['1.6']);
      expect(region()).not.toBeNull();
      expect(dirty.size).toBe(1);
      expect(container.textContent).not.toContain('forms.changedElsewhere');
      mocks.update.mockResolvedValueOnce(site(SAVED));
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith({ config: { typography: { leading: '1.6' } } });
      expect(region()).toBeNull();
    });

    it('keeps a newer different value set during the save, dirty, with no false conflict', async () => {
      await saveThenEditThenRefetch('2');
      expect(pressed('leading')).toEqual(['2.0']);
      expect(region()).not.toBeNull();
      expect(container.textContent).not.toContain('forms.changedElsewhere');
      mocks.update.mockResolvedValueOnce(site({ ...SAVED, leading: '2' }));
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith({ config: { typography: { leading: '2' } } });
      expect(region()).toBeNull();
    });
  });
});
