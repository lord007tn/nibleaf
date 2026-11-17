// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import type { RedirectRow } from '../model/redirects';
import { RedirectsSettings } from './redirects-settings';

const mocks = vi.hoisted(() => {
  /** Every Undo toast offered, with whether it was dismissed since. */
  const undoToasts: Array<{ id: number; undo: () => void; dismissed: boolean }> = [];
  const toast = Object.assign(
    (_message: string, options: { action: { onClick: () => void } }) => {
      const id = undoToasts.length + 1;
      undoToasts.push({ id, undo: options.action.onClick, dismissed: false });
      return id;
    },
    {
      error: vi.fn(),
      success: vi.fn(),
      dismiss: (id: number) => {
        const offered = undoToasts.find((item) => item.id === id);
        if (offered) offered.dismissed = true;
      },
    },
  );
  return { undoToasts, toast, updateProject: vi.fn() };
});

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Stored = { from: string; to: string; generated?: boolean };
const rule = (from: string, to: string, generated = false): RedirectRow => ({ from, to, generated });
/** As stored: one moved page (generated) and two rules the writer typed, one external with a query and fragment. */
const SAVED: RedirectRow[] = [
  rule('/guides/install', '/get-started/install', true),
  rule('/legacy', 'https://archive.example.com/docs?ref=nib#top'),
  rule('/دليل', '/ar/guide?lang=ar'),
];
const projectWith = (redirects: Stored[] | undefined, id = 'site-1', extra: Record<string, unknown> = {}) =>
  ({ id, config: { theme: { preset: 'nib' }, ...extra, ...(redirects ? { redirects } : {}) } }) as unknown as Project;
/** The server stores what it was sent and answers with the whole project. */
const storeWhatWasSent = () => mocks.updateProject.mockImplementation(async ({ config }) => projectWith(config.redirects));
const sent = () => mocks.updateProject.mock.lastCall?.[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

const render = (project: Project) => act(async () => root.render(<RedirectsSettings project={project} />));

// Found by their accessible names, so the suite also runs against main's component.
const byLabel = <T extends HTMLElement>(label: string) => [...container.querySelectorAll<T>(`[aria-label="${label}"]`)];
const fromInputs = () => byLabel<HTMLInputElement>('settings.redirects.fromLabel');
const fromInput = (index: number) => fromInputs()[index] ?? null;
const toInput = (index: number) => byLabel<HTMLInputElement>('settings.redirects.toLabel')[index] ?? null;
const removeButton = (index: number) => byLabel<HTMLButtonElement>('settings.redirects.remove')[index] ?? null;
/** What the rows show, in order. */
const shown = () => fromInputs().map((_, index) => [fromInput(index)?.value, toInput(index)?.value]);
const rowsOf = (list: RedirectRow[]) => list.map(({ from, to }) => [from, to]);
const addButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'settings.redirects.add') ?? null;
const saveRegion = () => document.querySelector<HTMLElement>('[data-slot="save-region"]');
const buttonNamed = (name: string, scope: ParentNode = document) => {
  const found = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const announced = () => [...document.querySelectorAll('[role="status"]')].map((region) => region.textContent?.trim()).filter(Boolean);
const conflictShown = () => document.body.textContent?.includes('forms.changedElsewhere') ?? false;
const problemsShown = () => document.body.textContent?.includes('settings.redirects.invalid') ?? false;
const invalidFields = () => [...container.querySelectorAll('[aria-invalid="true"]')];

const type = (input: HTMLInputElement | null, value: string) =>
  act(async () => {
    if (!input) throw new Error('No such field');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const leave = (input: HTMLInputElement | null) =>
  act(async () => {
    if (!input) throw new Error('No such field');
    input.focus();
    input.blur();
  });
const click = (element: HTMLElement | null) =>
  act(async () => {
    if (!element) throw new Error('Nothing to click');
    element.click();
  });
const save = () => click(buttonNamed('common.save', saveRegion() ?? undefined));
const discard = () => click(buttonNamed('forms.discard', saveRegion() ?? undefined));
/** The newest Undo toast's button, clicked even if the toast was dismissed (a click during its exit). */
const clickUndo = () =>
  act(async () => {
    const offered = mocks.undoToasts.at(-1);
    if (!offered) throw new Error('No Undo offered');
    offered.undo();
  });
const undoOnScreen = () => mocks.undoToasts.some((item) => !item.dismissed);
/** Enter as the browser delivers it: the keydown, then implicit submission's click on the default button. */
const pressEnter = async (input: HTMLInputElement | null) => {
  await act(async () => {
    if (!input) throw new Error('No such field');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    input.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
};
const pressSaveShortcut = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.undoToasts.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('RedirectsSettings — rows', () => {
  it('shows the stored rules in order, paths left to right in every locale, with no save bar', async () => {
    await render(projectWith(SAVED));
    expect(shown()).toEqual(rowsOf(SAVED));
    expect([...fromInputs(), toInput(0)].every((input) => input?.dir === 'ltr')).toBe(true);
    // Remove is named after its row: its own label, then a hidden label holding the rule's source.
    const [own, source] = removeButton(1)?.getAttribute('aria-labelledby')?.split(' ') ?? [];
    expect(removeButton(1)?.id).toBe(own);
    expect(document.getElementById(source ?? '')?.textContent).toBe('⁦/legacy⁩');
    expect(saveRegion()).toBeNull();
    expect(problemsShown()).toBe(false);
  });

  it('with nothing stored, explains redirects and offers Add in an empty state', async () => {
    await render(projectWith(undefined));
    expect(fromInputs()).toHaveLength(0);
    const empty = container.querySelector('[data-slot="empty-state"]');
    expect(empty?.textContent).toContain('settings.redirects.description');
    expect(empty?.contains(addButton())).toBe(true);
  });

  it('Add, typing, Remove and Undo change only the draft; nothing is sent until Save', async () => {
    await render(projectWith(SAVED));
    await click(addButton());
    expect(shown().at(-1)).toEqual(['', '']);
    expect(document.activeElement).toBe(fromInput(3));
    await type(fromInput(3), '/blog');
    await click(removeButton(0));
    await clickUndo();
    expect(saveRegion()).not.toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("removing a middle row keeps the neighbours' edits and order, and Undo puts it back in place", async () => {
    await render(projectWith(SAVED));
    await type(toInput(0), '/start/install');
    await type(toInput(2), '/ar/start');
    await click(removeButton(1));
    expect(shown()).toEqual([
      ['/guides/install', '/start/install'],
      ['/دليل', '/ar/start'],
    ]);
    expect(document.activeElement).toBe(removeButton(1));
    // Edited after the removal: Undo keeps it.
    await type(fromInput(1), '/دليل-قديم');
    await clickUndo();
    expect(shown()).toEqual([
      ['/guides/install', '/start/install'],
      ['/legacy', 'https://archive.example.com/docs?ref=nib#top'],
      ['/دليل-قديم', '/ar/start'],
    ]);
    // This toast is a stand-in, so focus never left the person: it stays on the same rule's Remove, now a row down.
    // Focus with the real toast: redirects-settings.undo-focus.test.tsx.
    expect(document.activeElement).toBe(removeButton(2));
    // Undo works once.
    await clickUndo();
    expect(fromInputs()).toHaveLength(3);
  });

  it('removing the only row shows the empty state and moves focus to Add', async () => {
    await render(projectWith([SAVED[1] as RedirectRow]));
    await click(removeButton(0));
    expect(container.querySelector('[data-slot="empty-state"]')).not.toBeNull();
    expect(document.activeElement).toBe(addButton());
  });
});

describe('RedirectsSettings — generated provenance', () => {
  // The council case from the old section's test, now with a real edit: a save
  // sends the rule's flag as stored until the writer edits that rule.
  it('a generated rule keeps its flag when another row changes', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await type(toInput(1), 'https://archive.example.com/v2');
    await save();
    expect(sent()).toEqual({
      config: {
        redirects: [SAVED[0], rule('/legacy', 'https://archive.example.com/v2'), SAVED[2]],
      },
    });
    expect(sent().config.redirects[0].generated).toBe(true);
  });

  it.each([
    ['source', fromInput, '/guides/setup'],
    ['destination', toInput, 'https://example.com/custom'],
  ])('editing its %s makes a generated rule the writer’s', async (_name, field, text) => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await type(field(0), text);
    await save();
    const [first] = sent().config.redirects;
    expect(first.generated).toBe(false);
    expect(first).toEqual(field === fromInput ? rule(text, '/get-started/install') : rule('/guides/install', text));
  });

  it('Remove then Undo puts the rule back with its generated flag', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await clickUndo();
    await type(toInput(2), '/ar/guide-2?lang=ar');
    await save();
    expect(sent().config.redirects).toEqual([SAVED[0], SAVED[1], rule('/دليل', '/ar/guide-2?lang=ar')]);
  });
});

describe('RedirectsSettings — saving', () => {
  it('sends the whole list as typed: blank rows left out, queries, fragments, Unicode and order kept, chains not flattened', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(addButton());
    await click(addButton());
    await type(fromInput(4), ' /get-started/install/ ');
    await type(toInput(4), '/quick-start#first-steps');
    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    // /guides/install → /get-started/install → /quick-start stays two rules, as written.
    expect(sent()).toEqual({ config: { redirects: [...SAVED, rule(' /get-started/install/ ', '/quick-start#first-steps')] } });
    expect(shown()).toEqual([...rowsOf(SAVED), [' /get-started/install/ ', '/quick-start#first-steps']]);
    expect(saveRegion()).toBeNull();
    expect(announced()).toEqual(['common.saved']);
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('deleting the last rule sends an empty list, and the refetch stays empty and clean', async () => {
    storeWhatWasSent();
    await render(projectWith([SAVED[0] as RedirectRow]));
    await click(removeButton(0));
    await save();
    expect(sent()).toEqual({ config: { redirects: [] } });
    await render(projectWith([]));
    expect(fromInputs()).toHaveLength(0);
    expect(saveRegion()).toBeNull();
    expect(conflictShown()).toBe(false);
  });

  it('Discard puts the saved rules back and retires a pending Undo', async () => {
    await render(projectWith(SAVED));
    await type(toInput(0), '/changed');
    await click(removeButton(1));
    await discard();
    expect(shown()).toEqual(rowsOf(SAVED));
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(fromInputs()).toHaveLength(3);
    expect(saveRegion()).toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('a failed save keeps the draft and its Undo, says so once, claims no success, and can be retried', async () => {
    mocks.updateProject.mockRejectedValueOnce(new Error('offline'));
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await save();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('Could not save');
    expect(announced()).toEqual([]);
    expect(fromInputs()).toHaveLength(2);
    expect(saveRegion()).not.toBeNull();
    expect(undoOnScreen()).toBe(true);

    storeWhatWasSent();
    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
    expect(saveRegion()).toBeNull();
    expect(undoOnScreen()).toBe(false);
    expect(announced()).toEqual(['common.saved']);
  });

  it('a completed save retires the Undo: after the refetch, a late click restores nothing', async () => {
    // Saved with Enter, which main's component also handles, so this runs against it unchanged.
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await pressEnter(toInput(0));
    expect(sent()).toEqual({ config: { redirects: SAVED.slice(1) } });
    await render(projectWith(SAVED.slice(1)));
    expect(undoOnScreen()).toBe(false);
    // A click on the toast as it leaves.
    await clickUndo();
    expect(shown()).toEqual(rowsOf(SAVED.slice(1)));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
  });

  it('its own filtered echo, rendered before the save resolves, is not a conflict', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await type(toInput(0), '/start');
    await click(addButton());
    await save();
    const echoed = [rule('/guides/install', '/start'), SAVED[1], SAVED[2]] as RedirectRow[];
    expect(sent()).toEqual({ config: { redirects: echoed } });
    await render(projectWith(echoed));
    expect(conflictShown()).toBe(false);
    await act(async () => pending.resolve(projectWith(echoed)));
    expect(shown()).toEqual(rowsOf(echoed));
    expect(conflictShown()).toBe(false);
    expect(saveRegion()).toBeNull();
  });

  it('a newer edit and a row added during the save survive its echo and success, unsaved', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await type(toInput(0), '/start');
    await save();
    const echoed = [rule('/guides/install', '/start'), SAVED[1], SAVED[2]] as RedirectRow[];
    await render(projectWith(echoed));
    await type(toInput(1), 'https://archive.example.com/v3');
    await click(addButton());
    await pressSaveShortcut();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(projectWith(echoed)));
    expect(conflictShown()).toBe(false);
    expect(shown()).toEqual([
      ...rowsOf([echoed[0] as RedirectRow]),
      ['/legacy', 'https://archive.example.com/v3'],
      ['/دليل', '/ar/guide?lang=ar'],
      ['', ''],
    ]);
    expect(saveRegion()).not.toBeNull();

    storeWhatWasSent();
    await save();
    expect(sent()).toEqual({ config: { redirects: [echoed[0], rule('/legacy', 'https://archive.example.com/v3'), SAVED[2]] } });
  });
});

describe('RedirectsSettings — refusing a draft', () => {
  it('a half-filled row shows its problem once left, not while typing', async () => {
    await render(projectWith(SAVED));
    await click(addButton());
    await type(fromInput(3), '/blog');
    expect(problemsShown()).toBe(false);
    expect(invalidFields()).toEqual([]);
    await leave(fromInput(3));
    expect(problemsShown()).toBe(true);
    expect(invalidFields()).toEqual([toInput(3)]);
    expect(document.body.textContent).toContain('A redirect must have both a source and a destination.');
  });

  it('Enter with a half-filled row saves nothing (no other change slips through), focuses it and asks for a fix', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await type(toInput(1), 'https://archive.example.com/v2');
    await click(addButton());
    await type(fromInput(3), '/blog');
    await pressEnter(fromInput(3));
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(toInput(3));
    expect(announced()).toEqual(['forms.fixHighlighted']);
    expect(shown()).toHaveLength(4);
    expect(saveRegion()).not.toBeNull();

    await type(toInput(3), '/news');
    expect(invalidFields()).toEqual([]);
    await pressEnter(toInput(3));
    expect(sent()).toEqual({
      config: { redirects: [SAVED[0], rule('/legacy', 'https://archive.example.com/v2'), SAVED[2], rule('/blog', '/news')] },
    });
    expect(announced()).toEqual(['common.saved']);
  });

  it('a cycle marks every rule in it; a problem in the summary takes focus to its field', async () => {
    await render(projectWith(SAVED));
    await type(toInput(1), '/guides/install');
    await type(fromInput(1), '/get-started/install');
    await save();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(invalidFields()).toEqual([toInput(0), toInput(1)]);
    const problem = buttonNamed('Redirect cycle detected', container);
    expect(toInput(0)?.getAttribute('aria-describedby')).toBe(problem.closest('li')?.id);
    await click(problem);
    expect(document.activeElement).toBe(toInput(0));
  });

  it('too many rules points at the rows past the limit', async () => {
    const many = Array.from({ length: 100 }, (_, index) => rule(`/old-${index}`, '/current'));
    await render(projectWith(many));
    await click(addButton());
    await type(fromInput(100), '/old-100');
    await type(toInput(100), '/current');
    await save();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(fromInput(100));
    expect(invalidFields()).toEqual([fromInput(100), toInput(100)]);
    await click(removeButton(100));
    expect(invalidFields()).toEqual([]);
    expect(problemsShown()).toBe(false);
  });

  it('clean, busy and invalid saves never announce Saved', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    // Clean: Enter does nothing.
    await pressEnter(fromInput(0));
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    // Invalid.
    await type(toInput(0), '');
    await pressEnter(fromInput(0));
    expect(announced()).toEqual(['forms.fixHighlighted']);
    expect(mocks.updateProject).not.toHaveBeenCalled();
    // Busy: a second Enter during the save starts nothing and says nothing.
    await type(toInput(0), '/start');
    await pressEnter(toInput(0));
    await pressEnter(toInput(0));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(announced()).toEqual([]);
    await act(async () => pending.resolve(projectWith([rule('/guides/install', '/start'), SAVED[1], SAVED[2]] as RedirectRow[])));
    expect(announced()).toEqual(['common.saved']);
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe('RedirectsSettings — server changes', () => {
  it('a refetch while clean shows the new rules', async () => {
    await render(projectWith(SAVED));
    await render(projectWith([rule('/a', '/b')]));
    expect(shown()).toEqual([['/a', '/b']]);
    expect(saveRegion()).toBeNull();
  });

  it('a refetch of other settings keeps the draft and its Undo', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await render(projectWith(SAVED, 'site-1', { theme: { preset: 'other' } }));
    expect(fromInputs()).toHaveLength(2);
    expect(conflictShown()).toBe(false);
    await clickUndo();
    expect(fromInputs()).toHaveLength(3);
  });

  it('a different list while dirty keeps the draft whole and asks: Use theirs, or Keep mine', async () => {
    await render(projectWith(SAVED));
    await type(toInput(0), '/mine');
    await render(projectWith([rule('/guides/install', '/theirs', true), rule('/x', '/y')]));
    expect(shown()[0]).toEqual(['/guides/install', '/mine']);
    expect(fromInputs()).toHaveLength(3);
    expect(conflictShown()).toBe(true);

    await click(buttonNamed('forms.keepMine'));
    expect(conflictShown()).toBe(false);
    expect(shown()[0]).toEqual(['/guides/install', '/mine']);

    await render(projectWith([rule('/guides/install', '/theirs-again')]));
    await click(buttonNamed('forms.useTheirs'));
    expect(shown()).toEqual([['/guides/install', '/theirs-again']]);
    expect(saveRegion()).toBeNull();
  });

  it('a row removed after a conflict appeared is not restored once Use theirs is chosen', async () => {
    await render(projectWith(SAVED));
    await type(toInput(0), '/mine');
    await render(projectWith([rule('/guides/install', '/theirs'), SAVED[1] as RedirectRow]));
    expect(conflictShown()).toBe(true);
    await click(removeButton(1));
    expect(undoOnScreen()).toBe(true);
    await click(buttonNamed('forms.useTheirs'));
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(shown()).toEqual([
      ['/guides/install', '/theirs'],
      ['/legacy', 'https://archive.example.com/docs?ref=nib#top'],
    ]);
    expect(saveRegion()).toBeNull();
  });

  it("another site starts clean; the first site's Undo and save never reach it", async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await save();
    await render(projectWith([rule('/team', '/people')], 'site-2'));
    expect(shown()).toEqual([['/team', '/people']]);
    expect(undoOnScreen()).toBe(false);

    await clickUndo();
    await act(async () => pending.resolve(projectWith(SAVED.slice(1))));
    expect(shown()).toEqual([['/team', '/people']]);
    expect(saveRegion()).toBeNull();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
  });
});
