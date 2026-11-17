// @vitest-environment jsdom
import { computeAccessibleName } from 'dom-accessibility-api';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import arabicCatalog from '../../../../../../packages/i18n/messages/ar.json' with { type: 'json' };
import englishCatalog from '../../../../../../packages/i18n/messages/en.json' with { type: 'json' };
import type { RedirectRow } from '../model/redirects';
import { RedirectsSettings } from './redirects-settings';

// Remove's accessible name and focus around the real Sonner toast (#751).
// Toasts render in Sonner's own Toaster, so its focus handling runs as in the app.

const catalogs = { en: englishCatalog, ar: arabicCatalog } as unknown as Record<'en' | 'ar', Record<string, string>>;
const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  updateProject: vi.fn(),
  /** Every Undo offered, so a test can click one after its toast left the screen. */
  undoActions: [] as Array<() => void>,
}));
/** A message as the catalog holds it: `settings.redirects.fromLabel` is `settings_redirects_fromlabel`. */
const message = (key: string) => catalogs[mocks.locale][key.replaceAll('.', '_').toLowerCase()] ?? key;
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => message(key), translateFn: (key: string) => message(key) }));
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  const toast = Object.assign((title: string, options?: { action?: { onClick: (event: unknown) => void } }) => {
    const action = options?.action;
    if (action) mocks.undoActions.push(() => action.onClick({}));
    return actual.toast(title, options as never);
  }, actual.toast);
  return { ...actual, toast };
});
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const rule = (from: string, to: string, generated = false): RedirectRow => ({ from, to, generated });
/** Mixed direction: Latin paths, an Arabic one, and an external URL with a query and fragment. */
const SAVED: RedirectRow[] = [
  rule('/guides/install', '/get-started/install', true),
  rule('/legacy', 'https://archive.example.com/docs?ref=nib#top'),
  rule('/دليل', '/ar/guide?lang=ar'),
];
const projectWith = (redirects: RedirectRow[], id = 'site-1') =>
  ({
    id,
    config: { theme: { preset: 'nib' }, redirects: redirects.map(({ from, to, generated }) => ({ from, to, generated })) },
  }) as unknown as Project;
const storeWhatWasSent = () => mocks.updateProject.mockImplementation(async ({ config }) => projectWith(config.redirects));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
/** Outside the form: somewhere else a person can be. */
let elsewhere: HTMLButtonElement;

const render = (project: Project | null, toaster: { duration?: number } = {}) =>
  act(async () =>
    root.render(
      <>
        {project ? <RedirectsSettings key={project.id} project={project} /> : null}
        <Toaster {...toaster} />
      </>,
    ),
  );

const byLabel = <T extends HTMLElement>(key: string) => [...container.querySelectorAll<T>(`[aria-label="${message(key)}"]`)];
const fromInput = (index: number) => byLabel<HTMLInputElement>('settings.redirects.fromLabel')[index] ?? null;
const toInput = (index: number) => byLabel<HTMLInputElement>('settings.redirects.toLabel')[index] ?? null;
const removeButton = (index: number) => byLabel<HTMLButtonElement>('settings.redirects.remove')[index] ?? null;
const shown = () => byLabel<HTMLInputElement>('settings.redirects.fromLabel').map((from, index) => [from.value, toInput(index)?.value]);
const rowsOf = (list: RedirectRow[]) => list.map(({ from, to }) => [from, to]);
const saveRegion = () => document.querySelector<HTMLElement>('[data-slot="save-region"]');
const problemsShown = () => document.body.textContent?.includes(message('settings.redirects.invalid')) ?? false;

/** The Undo button of the toast on screen, not one on its way out. */
const undoOnScreen = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast]:not([data-removed="true"]) button')].find(
    (button) => button.textContent === message('settings.theme.undo'),
  ) ?? null;
/** Lets Sonner apply what it queued: it shows a toast on a timer and dismisses one on an animation frame. */
const toastsSettled = async () => {
  for (let tick = 0; tick < 10; tick += 1) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
};
/** Waits for the toast's own lifecycle to take it off the page (its exit runs on Sonner's timers). */
const toastGone = async () => {
  for (let tick = 0; tick < 100 && document.querySelector('[data-sonner-toast]'); tick += 1)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  expect(document.querySelector('[data-sonner-toast]')).toBeNull();
};
const click = (element: HTMLElement | null) =>
  act(async () => {
    if (!element) throw new Error('Nothing to click');
    element.focus();
    element.click();
  });
const type = (input: HTMLInputElement | null, value: string) =>
  act(async () => {
    if (!input) throw new Error('No such field');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
/** Undo as a click or Enter takes it: focus moves to the toast's button, then it is pressed. */
const pressUndo = async () => {
  await toastsSettled();
  await click(undoOnScreen());
};
/** Sonner's hotkey (Alt+T) into the toasts, then Enter on Undo. */
const undoFromKeyboard = async () => {
  await toastsSettled();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyT', bubbles: true }));
  });
  expect(document.activeElement?.closest('[data-sonner-toaster]')).not.toBeNull();
  await click(undoOnScreen());
};
/** Undo pressed without taking focus: a tap that focuses nothing, or a screen reader's click. */
const tapUndo = async () => {
  await toastsSettled();
  await act(async () => {
    const undo = undoOnScreen();
    if (!undo) throw new Error('No Undo on screen');
    undo.click();
  });
};
/** The newest Undo, clicked even after its toast left the screen (a click during its exit). */
const clickLateUndo = () =>
  act(async () => {
    const undo = mocks.undoActions.at(-1);
    if (!undo) throw new Error('No Undo offered');
    undo();
  });

beforeEach(() => {
  mocks.locale = 'en';
  mocks.undoActions.length = 0;
  mocks.updateProject.mockReset();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
  elsewhere = document.createElement('button');
  elsewhere.textContent = 'Elsewhere';
  container = document.createElement('div');
  document.body.append(elsewhere, container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  // Sonner keeps its toasts at module level: let this test's go.
  await act(async () => {
    const { toast } = await vi.importActual<typeof import('sonner')>('sonner');
    toast.dismiss();
  });
  container.remove();
  elsewhere.remove();
});

// Computed with dom-accessibility-api. On main it named Remove after the field's label; Chrome took the field's
// value instead (the embedded-control rule). The hidden label gives every implementation the source itself.
describe("RedirectsSettings — Remove's name", () => {
  it.each(['en', 'ar'] as const)("names each Remove after its rule's source, isolated left to right (%s)", async (locale) => {
    mocks.locale = locale;
    await render(projectWith(SAVED));
    const remove = catalogs[locale].settings_redirects_remove;
    expect([0, 1, 2].map((index) => computeAccessibleName(removeButton(index) as HTMLElement))).toEqual([
      `${remove} ⁦/guides/install⁩`,
      `${remove} ⁦/legacy⁩`,
      `${remove} ⁦/دليل⁩`,
    ]);
    // The name is not the field's label.
    expect(computeAccessibleName(removeButton(1) as HTMLElement)).not.toContain(catalogs[locale].settings_redirects_fromlabel);
  });

  it('follows the source as typed, and a blank source leaves just "Remove redirect"', async () => {
    await render(projectWith(SAVED));
    await type(fromInput(1), '/archive');
    expect(computeAccessibleName(removeButton(1) as HTMLElement)).toBe('Remove redirect ⁦/archive⁩');
    await type(fromInput(1), '  ');
    expect(computeAccessibleName(removeButton(1) as HTMLElement)).toBe('Remove redirect');
  });

  it('keeps the source out of the page: the label is hidden, with an id of its own per row', async () => {
    await render(projectWith(SAVED));
    const labels = [0, 1, 2].map((index) => document.getElementById(removeButton(index)?.getAttribute('aria-labelledby')?.split(' ')[1] ?? ''));
    expect(labels.every((label) => label?.hidden && label.dir === 'ltr')).toBe(true);
    expect(new Set(labels.map((label) => label?.id)).size).toBe(3);
    await render(projectWith([...SAVED, rule('/new', '/fresh')]));
    // Stable: another rule arriving leaves the other rows' labels where they were.
    expect([0, 1, 2].map((index) => removeButton(index)?.getAttribute('aria-labelledby')?.split(' ')[1])).toEqual(labels.map((label) => label?.id));
  });
});

describe('RedirectsSettings — focus around the real Undo toast', () => {
  it('Undo from a click restores the rule and puts focus in its source, past Sonner handing focus back', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    expect(document.activeElement).toBe(removeButton(1));
    await pressUndo();
    expect(shown()).toEqual(rowsOf(SAVED));
    expect(document.activeElement).toBe(fromInput(1));
    // The toast leaves on its own lifecycle, and focus stays put.
    await toastGone();
    expect(document.activeElement).toBe(fromInput(1));
    expect(saveRegion()).toBeNull();
  });

  it('Undo from the keyboard (Alt+T, then Enter) lands on the restored source too', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await undoFromKeyboard();
    expect(shown()).toEqual(rowsOf(SAVED));
    expect(document.activeElement).toBe(fromInput(0));
    await toastGone();
    expect(document.activeElement).toBe(fromInput(0));
  });

  it('a tap that focuses nothing still lands on the restored source', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(2));
    await act(async () => (document.activeElement as HTMLElement | null)?.blur());
    await tapUndo();
    expect(shown()).toEqual(rowsOf(SAVED));
    expect(document.activeElement).toBe(fromInput(2));
  });

  it('dismissed without Undo, Sonner returns focus to where it was and nothing comes back', async () => {
    await render(projectWith(SAVED), { duration: 100 });
    await click(removeButton(1));
    await toastsSettled();
    await act(async () => undoOnScreen()?.focus());
    await toastGone();
    expect(shown()).toEqual(rowsOf([SAVED[0], SAVED[2]] as RedirectRow[]));
    expect(document.activeElement).toBe(removeButton(1));
    expect(saveRegion()).not.toBeNull();
  });

  it('a person who moved on keeps their field, value and caret, and their edit is saved beside the restored rule', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(removeButton(1));
    // Now on the next rule's destination, typing.
    await type(toInput(1), '/ar/guide?lang=ar&v=2');
    toInput(1)?.setSelectionRange(3, 5);
    await tapUndo();
    expect(shown()).toEqual([
      ['/guides/install', '/get-started/install'],
      ['/legacy', 'https://archive.example.com/docs?ref=nib#top'],
      ['/دليل', '/ar/guide?lang=ar&v=2'],
    ]);
    // The same rule's field, one row down, the caret where it was.
    expect(document.activeElement).toBe(toInput(2));
    expect([toInput(2)?.selectionStart, toInput(2)?.selectionEnd]).toEqual([3, 5]);
    // Moving them was not leaving a row: no problems appear.
    expect(problemsShown()).toBe(false);
    expect(saveRegion()).not.toBeNull();

    // Ctrl+S, from the field they are in.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await toastsSettled();
    // #749's payload: every rule in order, as typed, with its generated flag.
    expect(mocks.updateProject.mock.lastCall?.[0]).toEqual({
      config: {
        redirects: [
          { from: '/guides/install', to: '/get-started/install', generated: true },
          { from: '/legacy', to: 'https://archive.example.com/docs?ref=nib#top', generated: false },
          { from: '/دليل', to: '/ar/guide?lang=ar&v=2', generated: false },
        ],
      },
    });
    // Read back: the project as the server answered the save.
    const answered: Project = await mocks.updateProject.mock.results.at(-1)?.value;
    await render(answered);
    expect(shown()[2]).toEqual(['/دليل', '/ar/guide?lang=ar&v=2']);
    expect(saveRegion()).toBeNull();
  });

  it('focus outside the form stays there', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await act(async () => elsewhere.focus());
    await tapUndo();
    expect(shown()).toEqual(rowsOf(SAVED));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('a row before the restored one keeps focus where it is', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(2));
    await type(fromInput(0), '/guides/setup');
    await tapUndo();
    expect(document.activeElement).toBe(fromInput(0));
    expect(shown()[2]).toEqual(['/دليل', '/ar/guide?lang=ar']);
  });
});

describe('RedirectsSettings — a stale Undo takes no focus', () => {
  it("after leaving, a click during the toast's exit restores nothing and moves nothing", async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await toastsSettled();
    await render(null);
    await act(async () => elsewhere.focus());
    await clickLateUndo();
    expect(document.activeElement).toBe(elsewhere);
    await toastGone();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("after a site change, the first site's Undo neither restores into the second nor takes focus", async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await toastsSettled();
    await render(projectWith([rule('/team', '/people')], 'site-2'));
    await act(async () => fromInput(0)?.focus());
    await clickLateUndo();
    expect(shown()).toEqual([['/team', '/people']]);
    expect(document.activeElement).toBe(fromInput(0));
  });

  it('after Use theirs, a late Undo restores nothing and takes no focus', async () => {
    await render(projectWith(SAVED));
    await type(toInput(0), '/mine');
    await render(projectWith([rule('/guides/install', '/theirs', true), SAVED[1] as RedirectRow]));
    await click(removeButton(1));
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === message('forms.useTheirs')) ?? null);
    const focused = document.activeElement;
    await clickLateUndo();
    expect(shown()).toEqual([
      ['/guides/install', '/theirs'],
      ['/legacy', 'https://archive.example.com/docs?ref=nib#top'],
    ]);
    expect(document.activeElement).toBe(focused);
  });
});
