// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import type { VariablePair } from '../model/variables';
import { VariablesSettings } from './variables-settings';

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

const pairs = (...list: Array<[string, string]>): VariablePair[] => list.map(([key, value]) => ({ key, value }));
const SAVED = pairs(['product', 'Acme'], ['version', '2.0'], ['support', 'help@acme.test']);
const projectWith = (variables: VariablePair[] | undefined, id = 'site-1', extra: Record<string, unknown> = {}) =>
  ({ id, config: { theme: { preset: 'nib' }, ...extra, ...(variables ? { variables } : {}) } }) as unknown as Project;
/** The server stores what it was sent and answers with the whole project. */
const storeWhatWasSent = () => mocks.updateProject.mockImplementation(async ({ config }) => projectWith(config.variables));

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

const render = (project: Project) => act(async () => root.render(<VariablesSettings project={project} />));

// Found by their accessible names, so the suite also runs against main's component.
const byLabel = <T extends HTMLElement>(label: string) => [...container.querySelectorAll<T>(`[aria-label="${label}"]`)];
const keyInputs = () => byLabel<HTMLInputElement>('settings.variables.keyLabel');
const rowsOf = keyInputs;
const keyInput = (index: number) => keyInputs()[index] ?? null;
const valueInput = (index: number) => byLabel<HTMLInputElement>('settings.variables.valueLabel')[index] ?? null;
const removeButton = (index: number) => byLabel<HTMLButtonElement>('settings.variables.remove')[index] ?? null;
/** What the rows show, in order. */
const shown = () => keyInputs().map((_, index) => [keyInput(index)?.value, valueInput(index)?.value]);
const addButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'settings.variables.add') ?? null;
const saveRegion = () => document.querySelector<HTMLElement>('[data-slot="save-region"]');
const buttonNamed = (name: string, scope: ParentNode = document) => {
  const found = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const announced = () => [...document.querySelectorAll('[role="status"]')].map((region) => region.textContent?.trim()).filter(Boolean);
const conflictShown = () => document.body.textContent?.includes('forms.changedElsewhere') ?? false;

const type = (input: HTMLInputElement | null, value: string) =>
  act(async () => {
    if (!input) throw new Error('No such field');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
const pressEnter = async (input: HTMLInputElement | null, init: KeyboardEventInit = {}) => {
  await act(async () => {
    if (!input) throw new Error('No such field');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
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

describe('VariablesSettings — rows', () => {
  it('shows the stored pairs in order, names left to right and values in their own direction, with no save bar', async () => {
    await render(projectWith(SAVED));
    expect(shown()).toEqual([
      ['product', 'Acme'],
      ['version', '2.0'],
      ['support', 'help@acme.test'],
    ]);
    expect(keyInput(0)?.dir).toBe('ltr');
    expect(valueInput(0)?.dir).toBe('auto');
    expect(keyInput(0)?.getAttribute('aria-label')).toBe('settings.variables.keyLabel');
    // Remove is named after its row: its own label, then the variable's name.
    const [own, name] = removeButton(1)?.getAttribute('aria-labelledby')?.split(' ') ?? [];
    expect(removeButton(1)?.id).toBe(own);
    expect(document.getElementById(name ?? '')).toBe(keyInput(1));
    expect(saveRegion()).toBeNull();
  });

  it('with nothing stored, explains variables and offers Add in an empty state', async () => {
    await render(projectWith(undefined));
    expect(rowsOf()).toHaveLength(0);
    const empty = container.querySelector('[data-slot="empty-state"]');
    expect(empty?.textContent).toContain('settings.variables.descriptionBefore');
    expect(empty?.textContent).toContain('{{ var.name }}');
    expect(empty?.contains(addButton())).toBe(true);
  });

  it('Add, typing, Remove and Undo change only the draft; nothing is sent until Save', async () => {
    await render(projectWith(SAVED));
    await click(addButton());
    expect(shown().at(-1)).toEqual(['', '']);
    expect(document.activeElement).toBe(keyInput(3));
    await type(keyInput(3), 'docs_url');
    await click(removeButton(0));
    await clickUndo();
    expect(saveRegion()).not.toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("removing a middle row keeps the neighbours' edits and order, and Undo puts it back in place", async () => {
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Acme Cloud');
    await type(valueInput(2), 'support@acme.test');
    await click(removeButton(1));
    expect(shown()).toEqual([
      ['product', 'Acme Cloud'],
      ['support', 'support@acme.test'],
    ]);
    // Focus moves to the next row's Remove, not the page.
    expect(document.activeElement).toBe(removeButton(1));
    // Edited after the removal: Undo keeps it.
    await type(keyInput(1), 'contact');
    await clickUndo();
    expect(shown()).toEqual([
      ['product', 'Acme Cloud'],
      ['version', '2.0'],
      ['contact', 'support@acme.test'],
    ]);
    expect(document.activeElement).toBe(keyInput(1));
    // Undo works once.
    await clickUndo();
    expect(rowsOf()).toHaveLength(3);
  });

  it('removing the only row shows the empty state and moves focus to Add', async () => {
    await render(projectWith(pairs(['product', 'Acme'])));
    await click(removeButton(0));
    expect(container.querySelector('[data-slot="empty-state"]')).not.toBeNull();
    expect(document.activeElement).toBe(addButton());
  });
});

describe('VariablesSettings — saving', () => {
  it('sends the whole list: blank-key rows left out, everything else exactly as typed', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await type(keyInput(0), ' product ');
    await type(valueInput(1), '');
    await click(addButton());
    await type(valueInput(3), 'value with no name');
    await click(addButton());
    await type(keyInput(4), '   ');
    await click(addButton());
    await type(keyInput(5), ' product ');
    await type(valueInput(5), '  Second  ');
    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith({
      config: {
        variables: pairs([' product ', 'Acme'], ['version', ''], ['support', 'help@acme.test'], [' product ', '  Second  ']),
      },
    });
    // The form shows what the server stored: the rows without a name were not.
    expect(shown()).toEqual([
      [' product ', 'Acme'],
      ['version', ''],
      ['support', 'help@acme.test'],
      [' product ', '  Second  '],
    ]);
    expect(saveRegion()).toBeNull();
    expect(announced()).toEqual(['common.saved']);
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('deleting the last saved row sends an empty list, and the refetch stays empty', async () => {
    storeWhatWasSent();
    await render(projectWith(pairs(['product', 'Acme'])));
    await click(removeButton(0));
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { variables: [] } });
    await render(projectWith([]));
    expect(rowsOf()).toHaveLength(0);
    expect(saveRegion()).toBeNull();
    expect(conflictShown()).toBe(false);
  });

  it('Discard puts the saved rows back and retires a pending Undo', async () => {
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Changed');
    await click(removeButton(1));
    await discard();
    expect(shown()).toEqual([
      ['product', 'Acme'],
      ['version', '2.0'],
      ['support', 'help@acme.test'],
    ]);
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(rowsOf()).toHaveLength(3);
    expect(saveRegion()).toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('a failed save keeps the draft and its Undo, says so once, and can be retried', async () => {
    mocks.updateProject.mockRejectedValueOnce(new Error('offline'));
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await save();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('Could not save');
    expect(announced()).toEqual([]);
    expect(rowsOf()).toHaveLength(2);
    expect(saveRegion()).not.toBeNull();
    expect(undoOnScreen()).toBe(true);

    storeWhatWasSent();
    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
    expect(saveRegion()).toBeNull();
    expect(undoOnScreen()).toBe(false);
  });

  it('a completed save retires the Undo: after the refetch, a late click restores nothing', async () => {
    // Saved with Enter, which main's component also handles, so this runs against it unchanged.
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await pressEnter(valueInput(0));
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { variables: SAVED.slice(1) } });
    await render(projectWith(SAVED.slice(1)));
    expect(undoOnScreen()).toBe(false);
    // A click on the toast as it leaves.
    await clickUndo();
    expect(shown()).toEqual([
      ['version', '2.0'],
      ['support', 'help@acme.test'],
    ]);
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
  });

  it('a save that left out a blank-key row settles on the stored rows, even when its refetch lands first', async () => {
    // The refetch can't match the draft (it lacks the unnamed row), so the whole
    // list may read as changed elsewhere until the save confirms; then it settles.
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Acme Cloud');
    await click(addButton());
    await type(valueInput(3), 'no name');
    await save();
    const stored = pairs(['product', 'Acme Cloud'], ['version', '2.0'], ['support', 'help@acme.test']);
    await render(projectWith(stored));
    await act(async () => pending.resolve(projectWith(stored)));
    expect(shown()).toEqual(stored.map(({ key, value }) => [key, value]));
    expect(conflictShown()).toBe(false);
    expect(saveRegion()).toBeNull();
  });

  it('edits made during the save survive it and stay unsaved; a second save waits its turn', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Acme Cloud');
    await save();
    await type(valueInput(1), '3.0');
    await click(addButton());
    await pressSaveShortcut();
    await pressEnter(valueInput(1));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(projectWith(pairs(['product', 'Acme Cloud'], ['version', '2.0'], ['support', 'help@acme.test']))));
    expect(shown()).toEqual([
      ['product', 'Acme Cloud'],
      ['version', '3.0'],
      ['support', 'help@acme.test'],
      ['', ''],
    ]);
    expect(saveRegion()).not.toBeNull();
    expect(conflictShown()).toBe(false);
  });
});

describe('VariablesSettings — server changes', () => {
  it('a refetch while clean shows the new rows', async () => {
    await render(projectWith(SAVED));
    await render(projectWith(pairs(['product', 'Acme 2'])));
    expect(shown()).toEqual([['product', 'Acme 2']]);
    expect(saveRegion()).toBeNull();
  });

  it('a refetch of other settings keeps the draft and its Undo', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await render(projectWith(SAVED, 'site-1', { theme: { preset: 'other' } }));
    expect(rowsOf()).toHaveLength(2);
    expect(conflictShown()).toBe(false);
    await clickUndo();
    expect(rowsOf()).toHaveLength(3);
  });

  it('a different list while dirty keeps the draft whole and asks: Use theirs, or Keep mine', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Mine');
    await render(projectWith(pairs(['product', 'Theirs'], ['locale', 'en'])));
    expect(shown()[0]).toEqual(['product', 'Mine']);
    expect(rowsOf()).toHaveLength(3);
    expect(conflictShown()).toBe(true);

    await click(buttonNamed('forms.keepMine'));
    expect(conflictShown()).toBe(false);
    expect(shown()[0]).toEqual(['product', 'Mine']);

    await render(projectWith(pairs(['product', 'Theirs again'])));
    await click(buttonNamed('forms.useTheirs'));
    expect(shown()).toEqual([['product', 'Theirs again']]);
    expect(saveRegion()).toBeNull();
  });

  it('a removed row is never restored into rows the server replaced', async () => {
    await render(projectWith(SAVED));
    await click(removeButton(1));
    await render(projectWith(pairs(['product', 'Theirs'])));
    await click(buttonNamed('forms.useTheirs'));
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(shown()).toEqual([['product', 'Theirs']]);
    expect(saveRegion()).toBeNull();
  });

  it('a row removed after a conflict appeared is not restored once Use theirs is chosen', async () => {
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Mine');
    await render(projectWith(pairs(['product', 'Theirs'], ['version', '2.0'])));
    expect(conflictShown()).toBe(true);
    // Offered on the baseline the conflict brought, so only accepting their list can retire it.
    await click(removeButton(1));
    expect(undoOnScreen()).toBe(true);
    await click(buttonNamed('forms.useTheirs'));
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(shown()).toEqual([
      ['product', 'Theirs'],
      ['version', '2.0'],
    ]);
    expect(saveRegion()).toBeNull();
  });

  it("another site starts clean; the first site's Undo and save never reach it", async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await save();
    await render(projectWith(pairs(['team', 'Docs']), 'site-2'));
    expect(shown()).toEqual([['team', 'Docs']]);
    expect(undoOnScreen()).toBe(false);

    await clickUndo();
    await act(async () => pending.resolve(projectWith(SAVED.slice(1))));
    expect(shown()).toEqual([['team', 'Docs']]);
    expect(saveRegion()).toBeNull();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});

describe('VariablesSettings — Enter and Ctrl+S', () => {
  it('Enter saves through the hidden default button, once, and the bar says Saved', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    const defaults = container.querySelectorAll<HTMLButtonElement>('form button[type="submit"]');
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.hidden).toBe(true);
    await click(removeButton(2));
    await pressEnter(valueInput(0));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { variables: SAVED.slice(0, 2) } });
    expect(announced()).toEqual(['common.saved']);
    expect(saveRegion()).toBeNull();
    // Enter goes through the same cleanup as Save.
    expect(undoOnScreen()).toBe(false);
  });

  it('sends nothing on Enter while clean, nor for modified or composing Enter', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await pressEnter(keyInput(0));
    expect(mocks.updateProject).not.toHaveBeenCalled();
    await type(valueInput(0), 'エーシーエム');
    for (const init of [{ isComposing: true }, { key: 'Process', keyCode: 229 }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }]) {
      await pressEnter(valueInput(0), init);
    }
    expect(mocks.updateProject).not.toHaveBeenCalled();
    await pressEnter(valueInput(0));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
  });

  it('Enter during a save starts nothing more', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(projectWith(SAVED));
    await type(valueInput(0), 'Acme Cloud');
    await pressEnter(valueInput(0));
    await pressEnter(keyInput(1));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve(projectWith(pairs(['product', 'Acme Cloud'], ...SAVED.slice(1).map((p): [string, string] => [p.key, p.value])))),
    );
    expect(announced()).toEqual(['common.saved']);
  });

  it('Ctrl+S saves and retires a pending Undo like Save', async () => {
    storeWhatWasSent();
    await render(projectWith(SAVED));
    await click(removeButton(0));
    await pressSaveShortcut();
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { variables: SAVED.slice(1) } });
    expect(undoOnScreen()).toBe(false);
    await clickUndo();
    expect(rowsOf()).toHaveLength(2);
  });
});
