// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DraftSave, type DraftSubmitResult, useServerDraftForm } from './use-server-draft';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Values = { name: string; description: string };
type Api = ReturnType<typeof useServerDraftForm<Values>>;
type Outcome = 'saved' | 'invalid' | 'failed';

function Harness({
  identity,
  source,
  onSubmit,
  expose,
}: {
  identity: string;
  source: Values;
  onSubmit: (values: Values, save: DraftSave<Values>) => Promise<Outcome>;
  expose: (api: Api) => void;
}) {
  const api = useServerDraftForm<Values>({ identity: [identity], source, onSubmit });
  expose(api);
  return null;
}

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

/** A form whose saves stay pending until the test finishes them. */
async function mount(identity: string, source: Values) {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  let api!: Api;
  const saves: Array<{ values: Values; save: DraftSave<Values>; finish: (outcome: Outcome) => void }> = [];
  const onSubmit = (values: Values, save: DraftSave<Values>) =>
    new Promise<Outcome>((resolve) => {
      saves.push({ values, save, finish: resolve });
    });
  const render = (nextIdentity: string, nextSource: Values) =>
    act(async () =>
      root.render(
        <Harness
          expose={(next) => {
            api = next;
          }}
          identity={nextIdentity}
          onSubmit={onSubmit}
          source={nextSource}
        />,
      ),
    );
  await render(identity, source);
  const set = (field: keyof Values, value: string) => act(async () => api.form.setFieldValue(field, value));
  /** Starts a submit and lets validation run until the save is in flight. `result` settles when the submit ends. */
  const submit = async () => {
    let result!: Promise<DraftSubmitResult>;
    await act(async () => {
      result = api.submit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { result };
  };
  /** Reports the save as confirmed by the server, then lets its submit finish. */
  const succeed = (index: number, confirmed?: Values) =>
    act(async () => {
      const entry = saves[index];
      entry?.save.succeeded(confirmed ?? entry.values);
      entry?.finish('saved');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return { render, saves, set, submit, succeed, api: () => api };
}

const original = { name: 'Original', description: 'd1' };

describe('useServerDraftForm: identity', () => {
  it('ignores a save that settles after switching to another site and back (A → B → A)', async () => {
    const { render, saves, set, submit, api } = await mount('site-a', { name: 'A', description: '' });
    await set('name', 'A edited');
    await submit();
    expect(saves).toHaveLength(1);
    await render('site-b', { name: 'B', description: '' });
    expect(api().form.state.values.name).toBe('B');
    await render('site-a', { name: 'A', description: '' });
    await set('name', 'A again');
    await act(async () => {
      expect(saves[0]?.save.isCurrent()).toBe(false);
      saves[0]?.save.succeeded({ name: 'A edited', description: '' });
      saves[0]?.finish('saved');
    });
    expect(api().form.state.values.name).toBe('A again');
    expect(api().baseline).toEqual({ name: 'A', description: '' });
    expect(api().isDirty).toBe(true);
  });

  it('applies a save that settles on the same identity', async () => {
    const { saves, set, submit, succeed, api } = await mount('site-a', original);
    await set('name', 'Renamed');
    await submit();
    expect(saves[0]?.save.isCurrent()).toBe(true);
    await succeed(0);
    expect(api().baseline).toEqual({ ...original, name: 'Renamed' });
    expect(api().isDirty).toBe(false);
    expect(api().isSaving).toBe(false);
  });
});

describe('useServerDraftForm: one save at a time', () => {
  it('refuses a second submit while one is in flight and keeps the newer text afterwards', async () => {
    const { saves, set, submit, succeed, api } = await mount('site', original);
    await set('name', 'A');
    const first = await submit();
    expect(api().isSaving).toBe(true);
    await set('name', 'AB');
    // Enter or Cmd+S again while the first save runs.
    expect(await (await submit()).result).toBe('busy');
    expect(saves).toHaveLength(1);
    await succeed(0);
    expect(await first.result).toBe('saved');
    expect(api().form.state.values.name).toBe('AB');
    expect(api().baseline.name).toBe('A');
    expect(api().isDirty).toBe(true);
    expect(api().isSaving).toBe(false);
  });

  it('only the save’s own completion ends “saving”', async () => {
    const { saves, set, submit, api } = await mount('site', original);
    await set('name', 'A');
    await submit();
    await submit();
    expect(api().isSaving).toBe(true);
    await act(async () => {
      saves[0]?.finish('failed');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api().isSaving).toBe(false);
    expect(api().isDirty).toBe(true);
  });
});

describe('useServerDraftForm: refetch during a save', () => {
  it('keeps the save in flight and its snapshot, so typing back and a refetch lose nothing', async () => {
    const { render, set, submit, succeed, api } = await mount('site', original);
    await set('name', 'Renamed');
    await submit();
    await set('name', 'Original');
    // Someone else changes the description; the refetch lands mid-save.
    await render('site', { name: 'Original', description: 'd2' });
    expect(api().isSaving).toBe(true);
    expect(api().form.state.values).toEqual({ name: 'Original', description: 'd2' });
    // The server stored what was sent ("Renamed", "d1").
    await succeed(0, { name: 'Renamed', description: 'd1' });
    expect(api().form.state.values.name).toBe('Original');
    expect(api().baseline.name).toBe('Renamed');
    expect(api().isDirty).toBe(true);
    expect(api().isSaving).toBe(false);
  });
});

describe('useServerDraftForm: conflicts', () => {
  it('keeps an unresolved conflict through unrelated refetches', async () => {
    const { render, set, api } = await mount('site', original);
    await set('name', 'Mine');
    await render('site', { name: 'Theirs', description: 'd1' });
    expect(api().conflicts).toEqual(['name']);
    await render('site', { name: 'Theirs', description: 'd2' });
    expect(api().conflicts).toEqual(['name']);
    expect(api().form.state.values).toEqual({ name: 'Mine', description: 'd2' });
  });

  it('clears a conflict when it is resolved or when the draft matches the server again', async () => {
    const { render, set, api } = await mount('site', original);
    await set('name', 'Mine');
    await render('site', { name: 'Theirs', description: 'd1' });
    await act(async () => api().resolveConflict('name', 'mine'));
    expect(api().conflicts).toEqual([]);

    await render('site', { name: 'Theirs again', description: 'd1' });
    expect(api().conflicts).toEqual(['name']);
    await set('name', 'Theirs again');
    await render('site', { name: 'Theirs again', description: 'd3' });
    expect(api().conflicts).toEqual([]);
  });
});

describe('useServerDraftForm: the save’s own refetch', () => {
  // Some mutation hooks resolve only after their own refetch, so the sent
  // values reach the form while the save is still in flight.
  const old = { name: '/old.svg', description: 'd1' };

  it('keeps a value typed back to the old one during the save', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await set('name', '/old.svg');
    await render('site', { name: '/sent.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/old.svg');
    expect(api().conflicts).toEqual([]);
    await succeed(0, { name: '/sent.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/old.svg');
    expect(api().baseline.name).toBe('/sent.svg');
    expect(api().isDirty).toBe(true);
    expect(api().conflicts).toEqual([]);
  });

  it('keeps a newer value typed during the save, without reporting its own save as a conflict', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await set('name', '/newer.svg');
    await render('site', { name: '/sent.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/newer.svg');
    expect(api().conflicts).toEqual([]);
    await succeed(0, { name: '/sent.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/newer.svg');
    expect(api().baseline.name).toBe('/sent.svg');
    expect(api().isDirty).toBe(true);
    expect(api().conflicts).toEqual([]);
  });

  it('keeps the sent value when a refetch from before the save lands during it', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    // A focus refetch that left before the save reached the server, carrying
    // someone else's description.
    await render('site', { name: '/old.svg', description: 'theirs' });
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'theirs' });
    expect(api().conflicts).toEqual([]);
    await succeed(0, { name: '/sent.svg', description: 'theirs' });
    expect(api().form.state.values.name).toBe('/sent.svg');
    expect(api().isDirty).toBe(false);
  });

  it('takes someone else’s change to a field the person did not touch', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await render('site', { name: '/sent.svg', description: 'theirs' });
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'theirs' });
    expect(api().conflicts).toEqual([]);
    expect(api().isDirty).toBe(false);
    // The server kept both changes.
    await succeed(0, { name: '/sent.svg', description: 'theirs' });
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'theirs' });
    expect(api().isDirty).toBe(false);
  });

  it('reports someone else’s change to a field the person sent as a conflict', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await render('site', { name: '/theirs.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/sent.svg');
    expect(api().conflicts).toEqual(['name']);
    // Their save landed after ours.
    await succeed(0, { name: '/sent.svg', description: 'd1' });
    expect(api().isSaving).toBe(false);
  });

  it('reports someone else’s change to a field the person edited during the save as a conflict', async () => {
    const { render, set, submit, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await set('description', 'mine');
    await render('site', { name: '/sent.svg', description: 'theirs' });
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'mine' });
    expect(api().conflicts).toEqual(['description']);
  });

  /** Submits a new name, then lands a refetch with someone else's description before the save's own refetch. */
  async function twoRefetches() {
    const draft = await mount('site', old);
    await draft.set('name', '/sent.svg');
    await draft.submit();
    await draft.render('site', { name: '/old.svg', description: 'd2' });
    expect(draft.api().form.state.values).toEqual({ name: '/sent.svg', description: 'd2' });
    await draft.render('site', { name: '/sent.svg', description: 'd3' });
    return draft;
  }

  it('takes each later refetch for a field the person did not send', async () => {
    const { api } = await twoRefetches();
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'd3' });
    expect(api().conflicts).toEqual([]);
    expect(api().isDirty).toBe(false);
  });

  it('is clean after a save that succeeds following two refetches', async () => {
    const { succeed, api } = await twoRefetches();
    await succeed(0, { name: '/sent.svg', description: 'd3' });
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'd3' });
    expect(api().baseline).toEqual({ name: '/sent.svg', description: 'd3' });
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('keeps the latest server values after a save that fails following two refetches', async () => {
    const { saves, api } = await twoRefetches();
    await act(async () => {
      saves[0]?.save.failed();
      saves[0]?.finish('failed');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api().isSaving).toBe(false);
    expect(api().form.state.values).toEqual({ name: '/sent.svg', description: 'd3' });
    expect(api().baseline).toEqual({ name: '/sent.svg', description: 'd3' });
    expect(api().conflicts).toEqual([]);
  });

  /** The save's echo, then someone else's change, then another. */
  async function echoThenTwoChanges() {
    const draft = await mount('site', old);
    await draft.set('name', '/sent.svg');
    await draft.submit();
    await draft.render('site', { name: '/sent.svg', description: 'd1' });
    await draft.render('site', { name: '/theirs.svg', description: 'd1' });
    expect(draft.api().form.state.values.name).toBe('/theirs.svg');
    expect(draft.api().conflicts).toEqual([]);
    await draft.render('site', { name: '/later.svg', description: 'd1' });
    expect(draft.api().form.state.values.name).toBe('/later.svg');
    expect(draft.api().conflicts).toEqual([]);
    return draft;
  }

  it('takes each change someone else makes to a sent field after the save’s echo', async () => {
    const { api } = await echoThenTwoChanges();
    expect(api().isDirty).toBe(false);
  });

  it('is clean after a save that succeeds following its echo and two later changes', async () => {
    const { succeed, api } = await echoThenTwoChanges();
    await succeed(0, { name: '/later.svg', description: 'd1' });
    expect(api().form.state.values.name).toBe('/later.svg');
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('keeps the latest server value after a save that fails following its echo and two later changes', async () => {
    const { saves, api } = await echoThenTwoChanges();
    await act(async () => {
      saves[0]?.save.failed();
      saves[0]?.finish('failed');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api().form.state.values.name).toBe('/later.svg');
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('keeps the edits and the server’s values after a failed save with a refetch', async () => {
    const { render, saves, set, submit, api } = await mount('site', old);
    await set('name', '/sent.svg');
    await submit();
    await set('name', '/newer.svg');
    // Someone else changed the description; the save itself failed.
    await render('site', { name: '/old.svg', description: 'theirs' });
    await act(async () => {
      saves[0]?.save.failed();
      saves[0]?.finish('failed');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api().isSaving).toBe(false);
    expect(api().form.state.values).toEqual({ name: '/newer.svg', description: 'theirs' });
    expect(api().baseline).toEqual({ name: '/old.svg', description: 'theirs' });
    expect(api().isDirty).toBe(true);
    expect(api().conflicts).toEqual([]);
  });
});

describe('useServerDraftForm: refetch sequences during a save', () => {
  // One field, `name`, across up to three refetches. O is the value before the
  // save, S what it sent, T and U someone else's values, E a newer edit.
  const O = '/o';
  const S = '/s';
  const T = '/t';
  const U = '/u';
  const E = '/e';
  type Person = 'untouched' | 'sent' | 'typed back' | 'edited';
  type End = { name: string; conflict: boolean; dirty: boolean };
  type Row = { person: Person; server: string[]; pending: End; confirmed: string; success: End };
  const end = (name: string, conflict: boolean, dirty: boolean): End => ({ name, conflict, dirty });
  const rows: Row[] = [
    { person: 'untouched', server: [S, T, U], pending: end(U, false, false), confirmed: U, success: end(U, false, false) },
    { person: 'untouched', server: [O, S, T], pending: end(T, false, false), confirmed: T, success: end(T, false, false) },
    { person: 'untouched', server: [T, S, U], pending: end(U, false, false), confirmed: U, success: end(U, false, false) },
    { person: 'sent', server: [S, T, U], pending: end(U, false, false), confirmed: U, success: end(U, false, false) },
    { person: 'sent', server: [O, S, T], pending: end(T, false, false), confirmed: T, success: end(T, false, false) },
    { person: 'sent', server: [T, S, U], pending: end(U, false, false), confirmed: U, success: end(U, false, false) },
    { person: 'sent', server: [T, U], pending: end(S, true, true), confirmed: U, success: end(U, false, false) },
    { person: 'sent', server: [O], pending: end(S, false, true), confirmed: S, success: end(S, false, false) },
    { person: 'typed back', server: [S], pending: end(O, false, true), confirmed: S, success: end(O, false, true) },
    { person: 'typed back', server: [S, T, U], pending: end(O, true, true), confirmed: U, success: end(O, true, true) },
    { person: 'typed back', server: [O, S, T], pending: end(O, true, true), confirmed: T, success: end(O, true, true) },
    { person: 'typed back', server: [T, S, U], pending: end(O, true, true), confirmed: U, success: end(O, true, true) },
    { person: 'edited', server: [S], pending: end(E, false, true), confirmed: S, success: end(E, false, true) },
    { person: 'edited', server: [S, T, U], pending: end(E, true, true), confirmed: U, success: end(E, true, true) },
    { person: 'edited', server: [T, S, U], pending: end(E, true, true), confirmed: U, success: end(E, true, true) },
  ];

  /** Runs a row up to its last refetch, leaving the save pending. */
  async function play({ person, server }: Row) {
    const draft = await mount('site', { name: O, description: 'd1' });
    // An untouched name still needs a save in flight: send the description instead.
    await draft.set(person === 'untouched' ? 'description' : 'name', person === 'untouched' ? 'mine' : S);
    await draft.submit();
    if (person === 'typed back') await draft.set('name', O);
    if (person === 'edited') await draft.set('name', E);
    const description = person === 'untouched' ? 'mine' : 'd1';
    for (const name of server) await draft.render('site', { name, description });
    return { ...draft, description };
  }
  const state = (api: Api): End => ({
    name: api.form.state.values.name,
    conflict: api.conflicts.includes('name'),
    dirty: api.form.state.values.name !== api.baseline.name,
  });

  for (const row of rows) {
    const label = `${row.person}, server ${row.server.join(' → ')}`;
    it(`${label}: while pending`, async () => {
      const { api } = await play(row);
      expect(state(api())).toEqual(row.pending);
    });
    it(`${label}: after success`, async () => {
      const { succeed, api, description } = await play(row);
      await succeed(0, { name: row.confirmed, description });
      expect(state(api())).toEqual(row.success);
    });
    it(`${label}: after failure, as it was while pending`, async () => {
      const { saves, api } = await play(row);
      await act(async () => {
        saves[0]?.save.failed();
        saves[0]?.finish('failed');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(api().isSaving).toBe(false);
      expect(state(api())).toEqual(row.pending);
    });
  }
});

describe('useServerDraftForm: a payload transformed before sending (toSent)', () => {
  type Variable = { key: string; value: string };
  type Vars = { variables: Variable[]; title: string };
  type VarsApi = ReturnType<typeof useServerDraftForm<Vars>>;
  /** Like the variables form: a row without a key is never sent. */
  const dropBlankKeys = (values: Vars): Vars => ({ ...values, variables: values.variables.filter((row) => row.key !== '') });
  /** Like the SEO form: strings are sent trimmed. */
  const trim = (values: Values): Values => ({ name: values.name.trim(), description: values.description.trim() });

  function SentHarness<V extends Record<string, unknown>>({
    source,
    toSent,
    onSubmit,
    expose,
  }: {
    source: V;
    toSent: (values: V) => V;
    onSubmit: (values: V, save: DraftSave<V>) => Promise<Outcome>;
    expose: (api: ReturnType<typeof useServerDraftForm<V>>) => void;
  }) {
    expose(useServerDraftForm<V>({ identity: ['site'], source, onSubmit, toSent }));
    return null;
  }

  /** A form whose adopter sends `toSent(values)`; its save stays pending until finished. */
  async function mountSent<V extends Record<string, unknown>>(source: V, toSent: (values: V) => V) {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    let api!: ReturnType<typeof useServerDraftForm<V>>;
    const saves: Array<{ sent: V; save: DraftSave<V>; finish: (outcome: Outcome) => void }> = [];
    const onSubmit = (values: V, save: DraftSave<V>) =>
      new Promise<Outcome>((resolve) => {
        saves.push({ sent: toSent(values), save, finish: resolve });
      });
    const render = (next: V) =>
      act(async () =>
        root.render(
          <SentHarness<V>
            expose={(value) => {
              api = value;
            }}
            onSubmit={onSubmit}
            source={next}
            toSent={toSent}
          />,
        ),
      );
    await render(source);
    const set = (field: keyof V & string, value: unknown) =>
      act(async () => (api.form.setFieldValue as (field: string, value: unknown) => void)(field, value));
    const submit = () =>
      act(async () => {
        void api.submit();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    /** The server stored what the adopter sent, or `confirmed`. */
    const succeed = (confirmed?: V) =>
      act(async () => {
        const entry = saves[0];
        entry?.save.succeeded(confirmed ?? entry.sent);
        entry?.finish('saved');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    const fail = () =>
      act(async () => {
        saves[0]?.save.failed();
        saves[0]?.finish('failed');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    return { render, saves, set, submit, succeed, fail, api: () => api };
  }

  const saved: Vars = {
    variables: [
      { key: 'product', value: 'Acme' },
      { key: 'version', value: '2.0' },
    ],
    title: 'Docs',
  };
  const unnamed = { key: '', value: 'no name' };
  const submitted = [{ key: 'product', value: 'Acme Cloud' }, { key: 'version', value: '2.0' }, unnamed];
  const stored: Vars = { ...saved, variables: submitted.slice(0, 2) };
  const later = [{ key: 'product', value: 'Acme Cloud' }, { key: 'version', value: '3.0' }, unnamed];

  /** The variables repro: the stored value (without the unnamed row) lands mid-save, and version is edited after or before it. */
  async function repro(order: 'refetch then edit' | 'edit then refetch') {
    const draft = await mountSent(saved, dropBlankKeys);
    await draft.set('variables', submitted);
    await draft.submit();
    expect(draft.saves[0]?.sent).toEqual(stored);
    if (order === 'edit then refetch') await draft.set('variables', later);
    await draft.render(stored);
    if (order === 'refetch then edit') await draft.set('variables', later);
    return draft;
  }
  /** The newer version and the unnamed row stay as dirty draft content, with no conflict. */
  const expectKept = (api: VarsApi) => {
    expect(api.conflicts).toEqual([]);
    expect(api.form.state.values.variables).toEqual(later);
    expect(api.baseline).toEqual(stored);
    expect(api.isDirty).toBe(true);
  };

  for (const order of ['refetch then edit', 'edit then refetch'] as const) {
    it(`takes the stored value as the save’s echo (${order})`, async () => {
      const { api } = await repro(order);
      expectKept(api());
    });
    it(`keeps the newer edit and the unnamed row after success (${order})`, async () => {
      const { succeed, api } = await repro(order);
      await succeed();
      expect(api().isSaving).toBe(false);
      expectKept(api());
    });
    it(`keeps the newer edit and the unnamed row after failure (${order})`, async () => {
      const { fail, api } = await repro(order);
      await fail();
      expect(api().isSaving).toBe(false);
      expectKept(api());
    });
  }

  it('still reports someone else’s change to an edited field and adopts it on an untouched one', async () => {
    const { render, set, submit, api } = await mountSent(saved, dropBlankKeys);
    await set('variables', submitted);
    await submit();
    const theirs = [{ key: 'product', value: 'Acme Enterprise' }];
    await render({ variables: theirs, title: 'Their docs' });
    expect(api().conflicts).toEqual(['variables']);
    expect(api().form.state.values).toEqual({ variables: submitted, title: 'Their docs' });
    await act(async () => api().resolveConflict('variables', 'theirs'));
    expect(api().form.state.values).toEqual({ variables: theirs, title: 'Their docs' });
    expect(api().isDirty).toBe(false);
  });

  it('keeps an edit made during the save as a conflict through someone else’s change and the save’s success', async () => {
    const { render, set, submit, succeed, api } = await mountSent(saved, dropBlankKeys);
    await set('variables', submitted);
    await submit();
    await set('variables', later);
    const theirs = [{ key: 'product', value: 'Acme Enterprise' }];
    await render({ variables: theirs, title: 'Their docs' });
    expect(api().conflicts).toEqual(['variables']);
    // Their save landed after ours.
    await succeed({ variables: theirs, title: 'Their docs' });
    expect(api().conflicts).toEqual(['variables']);
    expect(api().form.state.values).toEqual({ variables: later, title: 'Their docs' });
    expect(api().isDirty).toBe(true);
  });

  it('keeps an unnamed row through someone else’s change while a save that sent nothing for it is in flight', async () => {
    const { render, set, submit, succeed, api } = await mountSent(saved, dropBlankKeys);
    // Only an unnamed row: the save sends the variables unchanged, so it awaits no echo for them.
    await set('variables', [...saved.variables, unnamed]);
    await set('title', 'Guide');
    await submit();
    const theirs = [{ key: 'product', value: 'Acme Enterprise' }];
    await render({ variables: theirs, title: 'Guide' });
    expect(api().form.state.values.variables).toEqual([...saved.variables, unnamed]);
    expect(api().conflicts).toEqual(['variables']);
    await succeed({ variables: theirs, title: 'Guide' });
    expect(api().form.state.values).toEqual({ variables: [...saved.variables, unnamed], title: 'Guide' });
    expect(api().conflicts).toEqual(['variables']);
  });

  it('confirms a save whose only change toSent drops, and ends clean', async () => {
    const { set, submit, succeed, api } = await mountSent(saved, dropBlankKeys);
    await set('variables', [...saved.variables, unnamed]);
    await submit();
    await succeed();
    expect(api().form.state.values).toEqual(saved);
    expect(api().isDirty).toBe(false);
  });

  it('trims: the trimmed echo is no conflict, and the confirmed save is clean', async () => {
    const { render, set, submit, succeed, api } = await mountSent(original, trim);
    await set('name', 'Title  ');
    await submit();
    await render({ name: 'Title', description: 'd1' });
    expect(api().conflicts).toEqual([]);
    // The typed value stays until the save is confirmed.
    expect(api().form.state.values.name).toBe('Title  ');
    await render({ name: 'Title', description: 'd2' });
    expect(api().form.state.values).toEqual({ name: 'Title  ', description: 'd2' });
    await succeed({ name: 'Title', description: 'd2' });
    expect(api().form.state.values).toEqual({ name: 'Title', description: 'd2' });
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('trims: keeps an edit made during the save', async () => {
    const { render, set, submit, succeed, api } = await mountSent(original, trim);
    await set('name', 'Title  ');
    await submit();
    await set('name', 'Title 2');
    await render({ name: 'Title', description: 'd1' });
    expect(api().conflicts).toEqual([]);
    expect(api().form.state.values.name).toBe('Title 2');
    await succeed();
    expect(api().form.state.values.name).toBe('Title 2');
    expect(api().baseline.name).toBe('Title');
    expect(api().isDirty).toBe(true);
    expect(api().conflicts).toEqual([]);
  });

  it('trims: takes someone else’s change after the echo to a sent field the person left alone', async () => {
    const { render, set, submit, succeed, api } = await mountSent(original, trim);
    await set('name', 'Title  ');
    await submit();
    await render({ name: 'Title', description: 'd1' });
    await render({ name: 'Theirs', description: 'd1' });
    expect(api().conflicts).toEqual([]);
    expect(api().form.state.values.name).toBe('Theirs');
    await succeed({ name: 'Theirs', description: 'd1' });
    expect(api().form.state.values.name).toBe('Theirs');
    expect(api().isDirty).toBe(false);
  });

  it('trims: reports someone else’s change to a sent field before its echo as a conflict', async () => {
    const { render, set, submit, api } = await mountSent(original, trim);
    await set('name', 'Title  ');
    await submit();
    await render({ name: 'Theirs', description: 'd1' });
    expect(api().conflicts).toEqual(['name']);
    expect(api().form.state.values.name).toBe('Title  ');
  });

  it('trims: a save that only added spaces ends clean', async () => {
    const { set, submit, succeed, api } = await mountSent(original, trim);
    await set('name', 'Original  ');
    await submit();
    await succeed();
    expect(api().form.state.values.name).toBe('Original');
    expect(api().isDirty).toBe(false);
  });
});
