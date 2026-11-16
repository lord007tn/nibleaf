// @vitest-environment jsdom
import { useStore } from '@tanstack/react-form';
import { act, type ComponentProps, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from './save-region';
import { type DraftSave, useServerDraftForm } from './use-server-draft';

/**
 * The SaveRegion's announcement with real `useServerDraftForm` forms (#759):
 * "Saved" only when nothing is left to save or resolve, and never a fleeting
 * "Saved" before the forms' rendered dirty flags catch up.
 */

const { renders } = vi.hoisted(() => ({ renders: [] as string[] }));
// Every status the region renders, frame by frame, so a "Saved" that shows
// for a single render before an effect corrects it is caught too.
vi.mock('@nibleaf/design-system/components/ui/save-region', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/design-system/components/ui/save-region')>();
  return {
    SaveRegion: (props: ComponentProps<typeof actual.SaveRegion>) => {
      renders.push(String(props.status ?? ''));
      return <actual.SaveRegion {...props} />;
    },
  };
});
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Values = { name: string; description: string };
type Outcome = 'saved' | 'invalid' | 'failed';
type Draft = ReturnType<typeof useServerDraftForm<Values>>;

/** One form's saves, held until the test finishes them, and its latest hook state. */
function controls() {
  const saves: Array<{ values: Values; save: DraftSave<Values>; finish: (outcome: Outcome) => void }> = [];
  const self = {
    saves,
    draft: undefined as unknown as Draft,
    onSubmit: (values: Values, save: DraftSave<Values>) =>
      new Promise<Outcome>((resolve) => {
        saves.push({ values, save, finish: resolve });
      }),
  };
  return self;
}
type Controls = ReturnType<typeof controls>;

type Spec = { id: string; identity?: string; source: Values; controls: Controls; confirmFirst?: boolean; invalid?: boolean; instanceKey?: string };

/**
 * A settings form as the features write it: the draft, a submit that maps
 * 'busy' to 'failed', and the SaveRegion registration. `confirmFirst` asks
 * before saving (as the JWT handoff does) and saves from its dialog.
 */
function DraftForm({ id, identity = 'site-1', source, controls: own, confirmFirst = false, invalid = false }: Spec) {
  const draft = useServerDraftForm<Values>({ identity: [identity, id], source, onSubmit: own.onSubmit });
  own.draft = draft;
  const [confirming, setConfirming] = useState(false);
  const { submit: submitDraft } = draft;
  const save = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  const submit = useCallback(async () => {
    if (!confirmFirst) return save();
    setConfirming(true);
    return 'deferred' as const;
  }, [confirmFirst, save]);
  const formProps = useSaveRegionForm(id, {
    isDirty: draft.isDirty,
    isSubmitting: draft.isSaving,
    submit,
    discard: draft.discard,
    settlement: draft.settlement,
  });
  const name = useStore(draft.form.store, (state) => state.values.name);
  return (
    <form aria-label={id} noValidate {...formProps}>
      <SaveRegionSubmit />
      <input aria-invalid={invalid || undefined} aria-label={`${id} name`} readOnly value={name} />
      {confirming ? (
        <div role="dialog" aria-label={`${id} confirm`}>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              void save();
            }}
          >
            confirm
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            cancel
          </button>
        </div>
      ) : null}
    </form>
  );
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  renders.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const render = (specs: Spec[]) =>
  act(async () =>
    root.render(
      <SaveRegionProvider>
        {specs.map((spec) => (
          <DraftForm key={spec.instanceKey ?? spec.id} {...spec} />
        ))}
      </SaveRegionProvider>,
    ),
  );
const edit = (form: Controls, field: keyof Values, value: string) => act(async () => form.draft.form.setFieldValue(field, value));
/** Reports the save as confirmed (with the server's values, else what it sent) and lets the region's run go on. */
const succeed = (form: Controls, index: number, confirmed?: Values) =>
  act(async () => {
    const entry = form.saves[index];
    entry?.save.succeeded(confirmed ?? entry.values);
    entry?.finish('saved');
    await tick();
  });
const fail = (form: Controls, index: number) =>
  act(async () => {
    form.saves[index]?.save.failed();
    form.saves[index]?.finish('failed');
    await tick();
  });
const finish = (form: Controls, index: number, outcome: Outcome) =>
  act(async () => {
    form.saves[index]?.finish(outcome);
    await tick();
  });
const status = () => container.querySelector('[role="status"]')?.textContent;
const bar = () => container.querySelector('[data-slot="save-region"]');
const clickSave = () =>
  act(async () => {
    ([...container.querySelectorAll<HTMLButtonElement>('[data-slot="save-region"] button')].at(-1) as HTMLButtonElement).click();
    await tick();
  });
const clickDiscard = () =>
  act(async () => {
    container.querySelector<HTMLButtonElement>('[data-slot="save-region"] button')?.click();
    await tick();
  });
const pressEnterIn = (id: string) =>
  act(async () => {
    container.querySelector<HTMLButtonElement>(`form[aria-label="${id}"] button[type="submit"]`)?.click();
    await tick();
  });
const pressCtrlS = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await tick();
  });
/** The statuses rendered, in order, each run of repeats once: what the live region went through. */
const history = () => renders.filter((value, index) => index === 0 || value !== renders[index - 1]);

const old: Values = { name: 'Old', description: 'd1' };

describe('SaveRegion settlement: one form (#759)', () => {
  it('a save that went through but left a conflict says "Unsaved changes", never "Saved", and keeps the bar', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'Sent');
    await clickSave();
    // Someone else's value lands while the save is in flight.
    await render([{ id: 'a', source: { name: 'Theirs', description: 'd1' }, controls: a }]);
    await succeed(a, 0, { name: 'Sent', description: 'd1' });

    expect(a.draft.conflicts).toEqual(['name']);
    expect(a.draft.isDirty).toBe(true);
    expect(status()).toBe('forms.unsavedChanges');
    expect(bar()).not.toBeNull();
    expect(history()).not.toContain('common.saved');

    // Use theirs settles it, but it is no network save: "Unsaved changes" goes, quietly, and "Saved" never comes.
    await act(async () => a.draft.resolveConflict('name', 'theirs'));
    expect(a.draft.isDirty).toBe(false);
    expect(bar()).toBeNull();
    expect(status()).toBe('');
    expect(history()).toEqual(['', 'forms.unsavedChanges', '']);
  });

  it('"Keep mine" during the save leaves no conflict but an edit to save: "Unsaved changes"', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'Sent');
    await clickSave();
    await render([{ id: 'a', source: { name: 'Theirs', description: 'd1' }, controls: a }]);
    await act(async () => a.draft.resolveConflict('name', 'mine'));
    await succeed(a, 0, { name: 'Sent', description: 'd1' });
    expect(a.draft.conflicts).toEqual([]);
    expect(a.draft.isDirty).toBe(true);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).not.toContain('common.saved');
  });

  it.each([
    ['the same field', 'name' as const],
    ['another field', 'description' as const],
  ])('an edit to %s during the save keeps the draft and says "Unsaved changes"', async (_, field) => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'Sent');
    await clickSave();
    await edit(a, field, 'Newer');
    await succeed(a, 0);
    expect(a.draft.form.state.values[field]).toBe('Newer');
    expect(a.draft.baseline.name).toBe('Sent');
    expect(status()).toBe('forms.unsavedChanges');
    expect(bar()).not.toBeNull();
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('a clean success says "Saved" once, with nothing before it', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await succeed(a, 0);
    expect(status()).toBe('common.saved');
    expect(bar()).toBeNull();
    expect(history()).toEqual(['', 'common.saved']);
  });

  it('a normalized echo (the server trims what was sent) settles: "Saved"', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', '  New  ');
    await clickSave();
    await succeed(a, 0, { name: 'New', description: 'd1' });
    expect(a.draft.form.state.values.name).toBe('New');
    expect(status()).toBe('common.saved');
    expect(history()).toEqual(['', 'common.saved']);
  });

  it('a pristine form sends nothing and says nothing', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await pressEnterIn('a');
    await pressCtrlS();
    expect(a.saves).toHaveLength(0);
    expect(history()).toEqual(['']);
  });

  it('a failed save keeps the edits and the bar, and says nothing', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await fail(a, 0);
    expect(a.draft.form.state.values.name).toBe('New');
    expect(a.draft.isDirty).toBe(true);
    expect(bar()).not.toBeNull();
    expect(history()).toEqual(['']);
  });

  it('an invalid save highlights and focuses its field, never "Saved"', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a, invalid: true }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await finish(a, 0, 'invalid');
    expect(status()).toBe('forms.fixHighlighted');
    expect(document.activeElement).toBe(container.querySelector('[aria-label="a name"]'));
    expect(history()).not.toContain('common.saved');
  });

  it('a form already saving (busy) is not saved again and never reported "Saved"', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    // A save started outside the bar (as a feature's own button would) holds the form's lock.
    await act(async () => {
      void a.draft.submit();
      await tick();
    });
    await clickSave();
    expect(a.saves).toHaveLength(1);
    await succeed(a, 0);
    expect(history()).not.toContain('common.saved');
  });

  it('a save that asks first writes nothing and says nothing until confirmed, and the dialog owns the outcome', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a, confirmFirst: true }]);
    await edit(a, 'name', 'New');
    await clickSave();
    expect(a.saves).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].at(-1)?.click());
    expect(a.saves).toHaveLength(0);
    expect(a.draft.isDirty).toBe(true);

    await clickSave();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click();
      await tick();
    });
    expect(a.saves).toHaveLength(1);
    await succeed(a, 0);
    expect(a.draft.isDirty).toBe(false);
    expect(history()).toEqual(['']);
  });

  it.each([
    ['Save', clickSave],
    ['Enter', () => pressEnterIn('a')],
    ['Ctrl+S', pressCtrlS],
  ])('%s reports the same truthful outcome for an edit made during the save', async (_, start) => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'Sent');
    await start();
    expect(a.saves).toHaveLength(1);
    await edit(a, 'name', 'Newer');
    await succeed(a, 0);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('a new edit after "Saved" takes it back once, silently, without repeating on later keystrokes', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await succeed(a, 0);
    expect(status()).toBe('common.saved');
    await edit(a, 'name', 'Newer');
    await edit(a, 'name', 'Newest');
    await edit(a, 'description', 'd2');
    expect(status()).toBe('');
    expect(history()).toEqual(['', 'common.saved', '']);
  });

  it('an edit landing in the same batch as a clean save’s end is never claimed "Saved", in any rendered frame', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await act(async () => {
      const entry = a.saves[0];
      entry?.save.succeeded(entry.values);
      entry?.finish('saved');
      // The run's continuation reads every form settled and decides "Saved"…
      await tick();
      // …then, before React commits the clean registration, the person types again.
      a.draft.form.setFieldValue('name', 'Newer');
    });
    expect(a.draft.settlement().settled).toBe(false);
    expect(bar()).not.toBeNull();
    expect(status()).toBe('');
    await edit(a, 'name', 'Newest');
    expect(status()).toBe('');
    expect(history()).toEqual(['']);
  });

  it('Discard after "Unsaved changes" clears it, and Discard while the save is pending does nothing', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'Sent');
    await clickSave();
    await edit(a, 'name', 'Newer');
    await clickDiscard();
    expect(a.draft.form.state.values.name).toBe('Newer');
    await succeed(a, 0);
    expect(status()).toBe('forms.unsavedChanges');
    await clickDiscard();
    expect(a.draft.form.state.values.name).toBe('Sent');
    expect(status()).toBe('');
    expect(history()).not.toContain('common.saved');
  });

  it('a save that ends after the form moved to another site and back (A → B → A) says nothing', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    await render([{ id: 'a', identity: 'site-2', source: { name: 'B', description: '' }, controls: a }]);
    await render([{ id: 'a', source: old, controls: a }]);
    await succeed(a, 0);
    expect(a.draft.isDirty).toBe(false);
    expect(history()).toEqual(['']);
  });

  it('a save for a form replaced while it ran (remounted under the same id) says nothing', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    const first = a.saves[0];
    await render([{ id: 'a', source: old, controls: a, instanceKey: 'a-again' }]);
    await act(async () => {
      first?.save.succeeded(first.values);
      first?.finish('saved');
      await tick();
    });
    expect(history()).toEqual(['']);
  });

  it('a replaced form’s late "invalid" neither says so nor moves focus into the form that replaced it (#767)', async () => {
    const a = controls();
    await render([{ id: 'a', source: old, controls: a }]);
    await edit(a, 'name', 'New');
    await clickSave();
    const first = a.saves[0];
    await render([{ id: 'a', source: old, controls: a, instanceKey: 'a-again', invalid: true }]);
    await edit(a, 'name', 'Newer');
    const elsewhere = document.createElement('button');
    container.append(elsewhere);
    elsewhere.focus();
    await finish(a, 0, 'invalid');
    expect(first?.save.isCurrent()).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
    expect(history()).toEqual(['']);
    // The new form is untouched, still to save, and saves on its own.
    expect(a.draft.isDirty).toBe(true);
    expect(a.draft.isSaving).toBe(false);
    await clickSave();
    expect(a.saves).toHaveLength(2);
    await succeed(a, 1);
    expect(history()).toEqual(['', 'common.saved']);
  });
});

describe('SaveRegion settlement: several forms', () => {
  const twoDirty = async (specs: { a?: Partial<Spec>; b?: Partial<Spec> } = {}) => {
    const a = controls();
    const b = controls();
    const list = () => [
      { id: 'a', source: old, controls: a, ...specs.a },
      { id: 'b', source: old, controls: b, ...specs.b },
    ];
    await render(list());
    await edit(a, 'name', 'A');
    await edit(b, 'name', 'B');
    return { a, b, list };
  };

  it('all clean after the run: "Saved" once', async () => {
    const { a, b } = await twoDirty();
    await clickSave();
    await succeed(a, 0);
    expect(b.saves).toHaveLength(1);
    await succeed(b, 0);
    expect(status()).toBe('common.saved');
    expect(history()).toEqual(['', 'common.saved']);
  });

  it('the first form settles and the second does not: "Unsaved changes"', async () => {
    const { a, b } = await twoDirty();
    await clickSave();
    await succeed(a, 0);
    await edit(b, 'name', 'B newer');
    await succeed(b, 0);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('a form edited again after its save, while the next one saves: "Unsaved changes"', async () => {
    const { a, b } = await twoDirty();
    await clickSave();
    await succeed(a, 0);
    await edit(a, 'name', 'A again');
    await succeed(b, 0);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('a form that was clean, edited while another saves, is not sent and stops "Saved"', async () => {
    const a = controls();
    const c = controls();
    await render([
      { id: 'a', source: old, controls: a },
      { id: 'c', source: old, controls: c },
    ]);
    await edit(a, 'name', 'A');
    await clickSave();
    await edit(c, 'name', 'C');
    await succeed(a, 0);
    expect(c.saves).toHaveLength(0);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('Enter saves its own form only, and the page is not "Saved" while another holds edits', async () => {
    const { a, b } = await twoDirty();
    await pressEnterIn('a');
    await succeed(a, 0);
    expect(b.saves).toHaveLength(0);
    expect(status()).toBe('forms.unsavedChanges');
    expect(history()).toEqual(['', 'forms.unsavedChanges']);
  });

  it('a sibling saving on its own, clean but still pending, then done: "Unsaved changes" clears silently, never "Saved"', async () => {
    const { a, b } = await twoDirty();
    // B saves on its own (as the JWT confirmation does), outside the bar's run.
    await act(async () => {
      void b.draft.submit();
      await tick();
    });
    // Its own echo lands: B is clean, but its save is still pending.
    await render([
      { id: 'a', source: old, controls: a },
      { id: 'b', source: { name: 'B', description: 'd1' }, controls: b },
    ]);
    expect(b.draft.isDirty).toBe(false);
    await pressEnterIn('a');
    await succeed(a, 0);
    expect(status()).toBe('forms.unsavedChanges');
    // B's completion changes only whether it is saving.
    await succeed(b, 0);
    expect(b.draft.settlement().settled).toBe(true);
    expect(bar()).toBeNull();
    expect(status()).toBe('');
    expect(history()).toEqual(['', 'forms.unsavedChanges', '']);
  });

  it('an invalid form stops the run before the next one', async () => {
    const { a, b } = await twoDirty({ a: { invalid: true } });
    await clickSave();
    await finish(a, 0, 'invalid');
    expect(b.saves).toHaveLength(0);
    expect(status()).toBe('forms.fixHighlighted');
    expect(history()).not.toContain('common.saved');
  });

  it('a form that asks first, beside one that saves clean: the rest save, and nothing says "Saved"', async () => {
    const { a, b } = await twoDirty({ a: { confirmFirst: true } });
    await clickSave();
    expect(a.saves).toHaveLength(0);
    await succeed(b, 0);
    expect(b.draft.isDirty).toBe(false);
    expect(history()).toEqual(['']);
  });

  it('a form unmounted before its turn is skipped', async () => {
    const { a, b } = await twoDirty();
    await clickSave();
    await render([{ id: 'a', source: old, controls: a }]);
    await succeed(a, 0);
    expect(b.saves).toHaveLength(0);
  });

  it('a form unmounted after its save, while the next one saves, makes the result stale: nothing said', async () => {
    const { a, b } = await twoDirty();
    await clickSave();
    await succeed(a, 0);
    await render([{ id: 'b', source: old, controls: b }]);
    await succeed(b, 0);
    expect(history()).toEqual(['']);
  });

  it('a form that moved to another site and back after its save, while the next one saves, says nothing', async () => {
    const { a, b, list } = await twoDirty({ b: { identity: 'shared' } });
    await clickSave();
    await succeed(a, 0);
    const [specA, specB] = list() as [Spec, Spec];
    await render([{ ...specA, identity: 'site-2', source: { name: 'B site', description: '' } }, specB]);
    await render([specA, specB]);
    await succeed(b, 0);
    expect(a.draft.isDirty).toBe(false);
    expect(b.draft.isDirty).toBe(false);
    expect(history()).toEqual(['']);
  });
});
