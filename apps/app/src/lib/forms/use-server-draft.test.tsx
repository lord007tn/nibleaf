// @vitest-environment jsdom
import { notifyManager, QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { Activity, act, StrictMode, Suspense, startTransition } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useServerDraftForm: settlement', () => {
  it('reads the form as it is now, not as it last rendered: settled only with no save in flight and nothing left', async () => {
    const { set, submit, succeed, api } = await mount('site', original);
    const settlement = api().settlement;
    expect(settlement()).toEqual({ settled: true, generation: 0 });
    await set('name', 'A');
    expect(settlement().settled).toBe(false);
    await submit();
    // Typed back while saving: the request can still change it.
    await set('name', 'Original');
    expect(settlement().settled).toBe(false);
    await set('name', 'A');
    await act(async () => {
      expect(settlement().settled).toBe(false);
      api().form.setFieldValue('name', 'AB');
      // No render in between: the edit counts at once.
      expect(settlement().settled).toBe(false);
    });
    await succeed(0, { ...original, name: 'A' });
    expect(settlement().settled).toBe(false);
    await set('name', 'A');
    expect(settlement().settled).toBe(true);
    expect(api().settlement).toBe(settlement);
  });

  it('is settled right after a clean confirmation, before the form re-renders', async () => {
    const { saves, set, submit, api } = await mount('site', original);
    await set('name', 'A');
    const { result } = await submit();
    await act(async () => {
      saves[0]?.save.succeeded(saves[0].values);
      saves[0]?.finish('saved');
      expect(await result).toBe('saved');
      expect(api().settlement().settled).toBe(true);
    });
  });

  it('moves to a new generation with each identity, and back', async () => {
    const { render, api } = await mount('site-a', original);
    const before = api().settlement().generation;
    await render('site-b', original);
    await render('site-a', original);
    expect(api().settlement().generation).toBe(before + 2);
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

/** What the form shows and holds: its values, the confirmed baseline and the conflicts. */
const snapshot = (api: Api) => ({ values: api.form.state.values, baseline: api.baseline, conflicts: api.conflicts });

describe('useServerDraftForm: a response that arrives after a refetch already landed (#743)', () => {
  // 'Theirs' is on screen before the PATCH response 'Sent' confirms. Values
  // can't tell whether it was written after the PATCH (the mutation's own
  // refetch read it) or before (and the PATCH overwrote it): the form never
  // drops the person's value for it, and "theirs" is the value they saw.
  const old = { name: 'Old', description: 'd1' };
  const sent = { name: 'Sent', description: 'd1' };
  const theirs = { name: 'Theirs', description: 'd1' };
  type Order = 'refetch then edit' | 'edit then refetch' | 'no edit';
  const edits = ['refetch then edit', 'edit then refetch'] as const;

  /** Sends 'Sent', then lands 'Theirs' and types 'Newer' in the given order; the save stays pending. */
  async function race(order: Order) {
    const draft = await mount('site', old);
    await draft.set('name', 'Sent');
    await draft.submit();
    if (order === 'edit then refetch') await draft.set('name', 'Newer');
    await draft.render('site', theirs);
    if (order === 'refetch then edit') await draft.set('name', 'Newer');
    expect(draft.api().conflicts).toEqual(['name']);
    return draft;
  }
  const mine = (order: Order) => (order === 'no edit' ? 'Sent' : 'Newer');

  for (const order of [...edits, 'no edit'] as const) {
    it(`keeps the person’s value and the conflict, and "Use theirs" takes their value (${order})`, async () => {
      const { succeed, api } = await race(order);
      await succeed(0, sent);
      expect(api().isSaving).toBe(false);
      expect(snapshot(api())).toEqual({ values: { name: mine(order), description: 'd1' }, baseline: theirs, conflicts: ['name'] });
      expect(api().isDirty).toBe(true);
      await act(async () => api().resolveConflict('name', 'theirs'));
      expect(api().form.state.values).toEqual(theirs);
      expect(api().isDirty).toBe(false);
      expect(api().conflicts).toEqual([]);
    });

    it(`"Keep mine" after the save keeps the person’s value to save next (${order})`, async () => {
      const { saves, submit, succeed, api } = await race(order);
      await succeed(0, sent);
      await act(async () => api().resolveConflict('name', 'mine'));
      expect(api().conflicts).toEqual([]);
      expect(api().isDirty).toBe(true);
      await submit();
      expect(saves[1]?.values).toEqual({ name: mine(order), description: 'd1' });
    });

    it(`"Keep mine" during the save survives its success (${order})`, async () => {
      const { succeed, api } = await race(order);
      await act(async () => api().resolveConflict('name', 'mine'));
      await succeed(0, sent);
      expect(snapshot(api())).toEqual({ values: { name: mine(order), description: 'd1' }, baseline: theirs, conflicts: [] });
      expect(api().isDirty).toBe(true);
    });

    it(`ends pending or failed as it did before the fix (${order})`, async () => {
      const { saves, api } = await race(order);
      const pending = snapshot(api());
      expect(pending).toEqual({ values: { name: mine(order), description: 'd1' }, baseline: theirs, conflicts: ['name'] });
      await act(async () => {
        saves[0]?.save.failed();
        saves[0]?.finish('failed');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(api().isSaving).toBe(false);
      expect(snapshot(api())).toEqual(pending);
    });
  }

  it('tells the submit handler whether the save settled, so it closes or moves on only then', async () => {
    const settle = async (draft: Awaited<ReturnType<typeof mount>>) => {
      let settled: boolean | undefined;
      await act(async () => {
        settled = draft.saves[0]?.save.succeeded(sent);
        draft.saves[0]?.finish('saved');
      });
      return settled;
    };
    expect(await settle(await race('no edit'))).toBe(false);
    const clean = await mount('site', old);
    await clean.set('name', 'Sent');
    await clean.submit();
    expect(await settle(clean)).toBe(true);
  });

  it('keeps a value typed away and back to the sent one during the save', async () => {
    const { set, succeed, api } = await race('refetch then edit');
    await set('name', 'Sent');
    await succeed(0, sent);
    expect(snapshot(api())).toEqual({ values: sent, baseline: theirs, conflicts: ['name'] });
    expect(api().isDirty).toBe(true);
  });

  it('keeps "Use theirs" chosen during the save, against the response, as before the fix', async () => {
    const { succeed, api } = await race('refetch then edit');
    await act(async () => api().resolveConflict('name', 'theirs'));
    await succeed(0, sent);
    expect(snapshot(api())).toEqual({ values: theirs, baseline: sent, conflicts: [] });
  });

  it('discards to their value after the save', async () => {
    const { succeed, api } = await race('refetch then edit');
    await succeed(0, sent);
    await act(async () => api().discard());
    expect(api().form.state.values).toEqual(theirs);
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('follows later changes after the save, against their value', async () => {
    const { render, succeed, api } = await race('refetch then edit');
    await succeed(0, sent);
    await render('site', { name: 'Later', description: 'd2' });
    expect(api().form.state.values).toEqual({ name: 'Newer', description: 'd2' });
    expect(api().conflicts).toEqual(['name']);
    await act(async () => api().resolveConflict('name', 'theirs'));
    expect(api().form.state.values.name).toBe('Later');
    expect(api().isDirty).toBe(false);
  });

  it('keeps each field against its own refetched value, and confirms the response for the rest', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', 'Sent');
    await set('description', 'Sent d');
    await submit();
    await set('name', 'Newer');
    // Their name; our description echoed.
    await render('site', { name: 'Theirs', description: 'Sent d' });
    await succeed(0, { name: 'Sent', description: 'Sent d' });
    expect(snapshot(api())).toEqual({
      values: { name: 'Newer', description: 'Sent d' },
      baseline: { name: 'Theirs', description: 'Sent d' },
      conflicts: ['name'],
    });
  });

  it('confirms the response for a field the form took from a refetch, as before the fix', async () => {
    const { render, set, submit, succeed, api } = await mount('site', old);
    await set('name', 'Sent');
    await submit();
    await render('site', { name: 'Sent', description: 'theirs' });
    await succeed(0, sent);
    expect(snapshot(api())).toEqual({ values: sent, baseline: sent, conflicts: [] });
  });

  describe('refetch histories, then the response', () => {
    // Only a refetched value that is neither where the save started ('Old'),
    // nor what it sent, nor what the response confirms ('Sent') is kept as the
    // baseline, and only while the form holds another value. A refetch from
    // before the save or the save's own echo, in any number or order, leaves
    // 'Sent'; a value the form took from a refetch confirms the response.
    const histories: Array<{ refetches: string[]; baseline: string; shown: string; conflict: boolean }> = [
      { refetches: ['Old'], baseline: 'Sent', shown: 'Sent', conflict: false },
      { refetches: ['Sent', 'Old'], baseline: 'Sent', shown: 'Sent', conflict: false },
      { refetches: ['Sent', 'Sent', 'Sent', 'Sent'], baseline: 'Sent', shown: 'Sent', conflict: false },
      { refetches: ['Old', 'Old', 'Sent', 'Sent', 'Old'], baseline: 'Sent', shown: 'Sent', conflict: false },
      { refetches: ['Theirs', 'Sent'], baseline: 'Sent', shown: 'Sent', conflict: false },
      { refetches: ['Theirs', 'Theirs', 'Theirs', 'Theirs'], baseline: 'Theirs', shown: 'Sent', conflict: true },
      { refetches: ['Old', 'Theirs', 'Old', 'Theirs'], baseline: 'Theirs', shown: 'Sent', conflict: true },
      { refetches: ['Old', 'Sent', 'Theirs', 'Later'], baseline: 'Sent', shown: 'Sent', conflict: false },
    ];
    for (const { refetches, baseline, shown, conflict } of histories) {
      it(`${refetches.join(' → ')}: ${baseline}`, async () => {
        const { render, set, submit, succeed, api } = await mount('site', old);
        await set('name', 'Sent');
        await submit();
        // A new object each time, as a refetch delivers it.
        for (const name of refetches) await render('site', { name, description: 'd1' });
        await succeed(0, sent);
        expect(api().baseline.name).toBe(baseline);
        expect(api().form.state.values.name).toBe(shown);
        expect(api().conflicts).toEqual(conflict ? ['name'] : []);
      });
    }
  });

  it('ignores the wall clock: the race ends alike with it fixed, going back or going forward', async () => {
    const ends: Array<ReturnType<typeof snapshot>> = [];
    for (const clock of [() => 0, (step: number) => 1e12 - step * 3_600_000, (step: number) => 1e12 + step * 3_600_000]) {
      let step = 0;
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock(step++));
      const { succeed, api } = await race('refetch then edit');
      await succeed(0, sent);
      ends.push(snapshot(api()));
      now.mockRestore();
    }
    expect(ends).toEqual(new Array(3).fill({ values: { name: 'Newer', description: 'd1' }, baseline: theirs, conflicts: ['name'] }));
  });

  it('ignores the response of a save from before an identity switch and back', async () => {
    const { render, saves, api } = await race('refetch then edit');
    await render('site-b', { name: 'B', description: '' });
    await render('site', { name: 'Again', description: 'd1' });
    await act(async () => {
      expect(saves[0]?.save.isCurrent()).toBe(false);
      saves[0]?.save.succeeded(sent);
      saves[0]?.finish('saved');
    });
    expect(snapshot(api())).toEqual({ values: { name: 'Again', description: 'd1' }, baseline: { name: 'Again', description: 'd1' }, conflicts: [] });
  });
});

describe('useServerDraftForm: with TanStack Query (#743)', () => {
  // The adopter mutations' shape (useUpdateProjectConfig): PATCH, await the
  // query's invalidation in onSuccess, then resolve with the PATCH response.
  // TanStack Query batches observer notifications onto its scheduler; it is
  // captured here and run explicitly, as the next tick would.
  const queued: Array<() => void> = [];
  beforeEach(() => notifyManager.setScheduler((callback) => queued.push(callback)));
  afterEach(() => {
    queued.length = 0;
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });
  const runBatchedNotifications = () =>
    act(async () => {
      while (queued.length) queued.shift()?.();
    });

  async function mountQuery() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
    const server = { stored: { name: 'Old', description: 'd1' } as Values, down: false };
    client.setQueryData(['site'], server.stored);
    const rendered: string[] = [];
    let respond!: (response: Values) => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const atConfirm: { cached?: Values; rendered?: string } = {};
    let api!: Api;

    function QueryForm() {
      const source = useQuery({
        queryKey: ['site'],
        queryFn: async () => {
          if (server.down) throw new Error('refetch failed');
          return server.stored;
        },
      }).data as Values;
      const mutation = useMutation({
        mutationFn: (_body: Values) =>
          new Promise<Values>((resolve) => {
            respond = resolve;
            requested();
          }),
        onSuccess: () => client.invalidateQueries({ queryKey: ['site'] }),
      });
      rendered.push(source.name);
      api = useServerDraftForm<Values>({
        identity: ['site'],
        source,
        onSubmit: async (values, save) => {
          const response = await mutation.mutateAsync(values);
          atConfirm.cached = client.getQueryData(['site']);
          atConfirm.rendered = rendered.at(-1);
          save.succeeded(response);
          return 'saved';
        },
      });
      return null;
    }

    const root = createRoot(document.createElement('div'));
    roots.push(root);
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <QueryForm />
        </QueryClientProvider>,
      ),
    );
    await runBatchedNotifications();
    const set = (field: keyof Values, value: string) => act(async () => api.form.setFieldValue(field, value));
    let result!: Promise<DraftSubmitResult>;
    const submit = () =>
      act(async () => {
        result = api.submit();
        await request;
      });
    /** Someone else stores `values`; a refetch (a focus refetch, say) reads it and renders. */
    const refetchRenders = async (values: Values) => {
      await act(async () => {
        server.stored = values;
        await client.refetchQueries({ queryKey: ['site'] });
      });
      await runBatchedNotifications();
    };
    /** The server holds `stored` when the PATCH responds `response`; the save's own refetch reads it, or fails. */
    const confirm = (response: Values, stored: Values | 'refetch fails') =>
      act(async () => {
        if (stored === 'refetch fails') server.down = true;
        else server.stored = stored;
        respond(response);
        expect(await result).toBe('saved');
      });
    return { client, set, submit, refetchRenders, confirm, atConfirm, rendered, api: () => api };
  }

  const sent = { name: 'Sent', description: 'd1' };
  const theirs = { name: 'Theirs', description: 'd1' };

  it('never adopts a value read before the PATCH when the save’s own refetch fails', async () => {
    const { client, set, submit, refetchRenders, confirm, api } = await mountQuery();
    await set('name', 'Sent');
    await submit();
    // Read before the PATCH lands; the PATCH then stores 'Sent' over it.
    await refetchRenders(theirs);
    expect(api().conflicts).toEqual(['name']);
    await confirm(sent, 'refetch fails');
    await runBatchedNotifications();
    expect(client.getQueryState(['site'])?.status).toBe('error');
    // 'Sent' stays in the form, so a later save can't write 'Theirs' back unasked.
    expect(snapshot(api())).toEqual({ values: sent, baseline: theirs, conflicts: ['name'] });
    expect(api().isDirty).toBe(true);
  });

  // The rest pass before the fix too: they pin the batched path, where the
  // refetched value reaches the form only after the confirmation.
  it('reconciles a refetched value that renders after the confirmation: the newer edit keeps its conflict', async () => {
    const { set, submit, confirm, atConfirm, rendered, api } = await mountQuery();
    await set('name', 'Sent');
    await submit();
    await set('name', 'Newer');
    await confirm(sent, theirs);
    // Confirmed while the cache held their value and the form's source did not yet.
    expect(atConfirm).toEqual({ cached: theirs, rendered: 'Old' });
    await runBatchedNotifications();
    expect(rendered.at(-1)).toBe('Theirs');
    expect(snapshot(api())).toEqual({ values: { name: 'Newer', description: 'd1' }, baseline: theirs, conflicts: ['name'] });
    await act(async () => api().resolveConflict('name', 'theirs'));
    expect(api().form.state.values).toEqual(theirs);
    expect(api().isDirty).toBe(false);
  });

  it('takes a refetched value that renders after the confirmation on a form the save left clean', async () => {
    const { set, submit, confirm, atConfirm, api } = await mountQuery();
    await set('name', 'Sent');
    await submit();
    await confirm(sent, theirs);
    expect(atConfirm).toEqual({ cached: theirs, rendered: 'Old' });
    await runBatchedNotifications();
    expect(snapshot(api())).toEqual({ values: theirs, baseline: theirs, conflicts: [] });
  });

  it('ends clean when the refetch is the save’s own echo', async () => {
    const { set, submit, confirm, api } = await mountQuery();
    await set('name', 'Sent');
    await submit();
    await confirm(sent, sent);
    await runBatchedNotifications();
    expect(snapshot(api())).toEqual({ values: sent, baseline: sent, conflicts: [] });
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
    toSent?: (values: V) => V;
    onSubmit: (values: V, save: DraftSave<V>) => Promise<Outcome>;
    expose: (api: ReturnType<typeof useServerDraftForm<V>>) => void;
  }) {
    expose(useServerDraftForm<V>({ identity: ['site'], source, onSubmit, toSent }));
    return null;
  }

  /** A form whose adopter sends `toSent(values)` (or the values); its save stays pending until finished. */
  async function mountSent<V extends Record<string, unknown>>(source: V, toSent?: (values: V) => V) {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    let api!: ReturnType<typeof useServerDraftForm<V>>;
    const saves: Array<{ sent: V; save: DraftSave<V>; finish: (outcome: Outcome) => void }> = [];
    const onSubmit = (values: V, save: DraftSave<V>) =>
      new Promise<Outcome>((resolve) => {
        saves.push({ sent: toSent ? toSent(values) : values, save, finish: resolve });
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

  it('clears a conflict once the save’s trimmed echo lands after someone else’s change', async () => {
    const { render, set, submit, succeed, api } = await mountSent(original, trim);
    await set('name', 'S  ');
    await submit();
    await render({ name: 'T', description: 'd1' });
    expect(api().conflicts).toEqual(['name']);
    await render({ name: 'S', description: 'd1' });
    expect(api().conflicts).toEqual([]);
    await succeed();
    expect(api().form.state.values.name).toBe('S');
    expect(api().isDirty).toBe(false);
    expect(api().conflicts).toEqual([]);
  });

  it('clears a conflict once the save’s echo without the unnamed row lands after someone else’s change', async () => {
    const { render, set, submit, succeed, api } = await mountSent(saved, dropBlankKeys);
    await set('variables', submitted);
    await submit();
    await render({ ...saved, variables: [{ key: 'product', value: 'Acme Enterprise' }] });
    expect(api().conflicts).toEqual(['variables']);
    await render(stored);
    expect(api().conflicts).toEqual([]);
    expect(api().form.state.values.variables).toEqual(submitted);
    await succeed();
    expect(api().form.state.values).toEqual(stored);
    expect(api().conflicts).toEqual([]);
  });

  describe('a baseline toSent would change (stored before trimming)', () => {
    const untrimmed = { name: ' O', description: 'd1' };

    it('confirms a save that only added spaces, with or without a response', async () => {
      for (const confirmed of [undefined, { name: 'O', description: 'd1' }]) {
        const { set, submit, succeed, api } = await mountSent(untrimmed, trim);
        await set('name', ' O  ');
        await submit();
        await succeed(confirmed);
        expect(api().form.state.values.name).toBe('O');
        expect(api().isDirty).toBe(false);
        expect(api().conflicts).toEqual([]);
      }
    });

    it('takes the save’s own normalizing refetch as no change, never a conflict', async () => {
      const { render, set, submit, succeed, api } = await mountSent(untrimmed, trim);
      await set('name', ' O  ');
      await submit();
      await render({ name: 'O', description: 'd1' });
      expect(api().conflicts).toEqual([]);
      await succeed();
      expect(api().form.state.values.name).toBe('O');
      expect(api().isDirty).toBe(false);
      expect(api().conflicts).toEqual([]);
    });
  });

  describe('histories over trimmed and untrimmed baselines', () => {
    // One field, `name`, trimmed when sent. Each history is checked against
    // the same history without toSent, with every value already trimmed: in
    // sent space the two must end alike. The one intended difference: spaces
    // the person typed (sending nothing new) are kept as a conflict against
    // someone else's value instead of being replaced by it.
    type Sequence = string[];
    type Submit = 'S  ' | 'S' | 'spaces' | 'untouched';
    type During = 'untouched' | 'edited';
    type Seen = { name: string; conflict: boolean; dirty: boolean };

    type History = { baseline: string; submit: Submit; during: During; server: Sequence };
    const histories: History[] = [];
    for (const baseline of ['O', ' O']) {
      for (const submit of ['S  ', 'S', 'spaces', 'untouched'] as const) {
        const own = submit === 'spaces' || submit === 'untouched' ? baseline.trim() : 'S';
        for (const during of ['untouched', 'edited'] as const) {
          for (const server of [[], [own], ['T'], ['T', own], [own, 'T']]) histories.push({ baseline, submit, during, server });
        }
      }
    }

    /** Runs a history to the end of its refetches, transformed or as its trimmed equivalent. */
    async function play({ baseline, submit, during, server }: History, transformed: boolean) {
      const normalize = (value: string) => (transformed ? value : value.trim());
      const description = submit === 'untouched' ? 'mine' : 'd1';
      const draft = await mountSent({ name: normalize(baseline), description: 'd1' }, transformed ? trim : undefined);
      if (submit === 'untouched') await draft.set('description', 'mine');
      else await draft.set('name', normalize(submit === 'spaces' ? `${baseline}  ` : submit));
      await draft.submit();
      if (during === 'edited') await draft.set('name', 'E');
      for (const name of server) await draft.render({ name, description });
      return { ...draft, description };
    }
    const seen = (api: ReturnType<typeof useServerDraftForm<Values>>): Seen => ({
      name: api.form.state.values.name.trim(),
      conflict: api.conflicts.includes('name'),
      dirty: api.form.state.values.name.trim() !== api.baseline.name.trim(),
    });
    const confirmedName = ({ server }: History, own: string) => (server.at(-1) === 'T' && server.includes(own) ? 'T' : own);

    /** Plays a history to an outcome and reports what the form shows. */
    async function outcome(history: History, transformed: boolean, end: 'pending' | 'success' | 'failure') {
      const draft = await play(history, transformed);
      if (end === 'success') {
        const own = draft.saves[0]?.sent.name ?? '';
        await draft.succeed({ name: confirmedName(history, own.trim()), description: draft.description });
      }
      if (end === 'failure') await draft.fail();
      if (end !== 'pending') expect(draft.api().isSaving).toBe(false);
      return seen(draft.api());
    }

    for (const history of histories) {
      const label = `baseline "${history.baseline}", sends ${history.submit}, ${history.during}, server ${history.server.join(' → ') || 'silent'}`;
      it(label, async () => {
        const typedSpacesOnly = history.submit === 'spaces' && history.during === 'untouched';
        for (const end of ['pending', 'success', 'failure'] as const) {
          const expected = await outcome(history, false, end);
          const actual = await outcome(history, true, end);
          // Typed spaces stay as the person's edit against someone else's value, the last one seen.
          if (typedSpacesOnly && history.server.at(-1) === 'T')
            expect(actual).toEqual({ name: history.baseline.trim(), conflict: true, dirty: true });
          else expect(actual).toEqual(expected);
        }
      });
    }
  });
});

describe('useServerDraftForm: a save belongs to the mount that started it (#767)', () => {
  /**
   * A form that can unmount and mount again: `key` names the mount, `shown:
   * false` leaves nothing in its place (another site's section loading, say),
   * `hidden` keeps it inside a hidden <Activity>, `suspend` has a sibling
   * suspend so React abandons the render, `validated` adds an async submit
   * validator the test resolves. Each mount's hook is kept by key.
   */
  type Shape = {
    key?: string;
    shown?: boolean;
    hidden?: boolean;
    identity?: string;
    source?: Values;
    strict?: boolean;
    suspend?: boolean;
    validated?: boolean;
  };
  type Entry = { values: Values; save: DraftSave<Values>; finish: (outcome: Outcome) => void; fail: (error: unknown) => void };

  function Suspends(): null {
    throw new Promise(() => undefined);
  }

  async function lifetimes(initial: Shape = {}) {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    const apis = new Map<string, Api>();
    const saves: Entry[] = [];
    const validations: Array<() => void> = [];
    const onSubmit = (values: Values, save: DraftSave<Values>) =>
      new Promise<Outcome>((resolve, reject) => {
        saves.push({ values, save, finish: resolve, fail: reject });
      });
    function Form({ name, identity, source, validated }: { name: string; identity: string; source: Values; validated: boolean }) {
      const api = useServerDraftForm<Values>({ identity: [identity], source, onSubmit });
      apis.set(name, api);
      if (!validated) return null;
      return (
        <api.form.Field
          name="name"
          validators={{ onSubmitAsync: () => new Promise<undefined>((resolve) => validations.push(() => resolve(undefined))) }}
        >
          {() => null}
        </api.form.Field>
      );
    }
    let shape: Required<Shape> = {
      key: 'first',
      shown: true,
      hidden: false,
      identity: 'site-a',
      source: original,
      strict: false,
      suspend: false,
      validated: false,
    };
    const tree = (next: Required<Shape>) => {
      const body = (
        <Suspense fallback={null}>
          <Activity mode={next.hidden ? 'hidden' : 'visible'}>
            {next.shown ? <Form identity={next.identity} key={next.key} name={next.key} source={next.source} validated={next.validated} /> : null}
          </Activity>
          {next.suspend ? <Suspends /> : null}
        </Suspense>
      );
      return next.strict ? <StrictMode>{body}</StrictMode> : body;
    };
    const render = async (next: Shape = {}) => {
      shape = { ...shape, ...next };
      await act(async () => root.render(tree(shape)));
    };
    await render(initial);
    const api = (name = shape.key) => apis.get(name) as Api;
    /**
     * Starts a submit and waits until its request is in flight, its validator
     * is pending, or it ended. `result` settles when the submit ends.
     */
    const submit = async () => {
      const before = { saves: saves.length, validations: validations.length };
      let ended = false;
      let result!: Promise<DraftSubmitResult>;
      await act(async () => {
        result = api().submit();
        const end = () => {
          ended = true;
        };
        void result.then(end, end);
        await vi.waitFor(() => expect(ended || saves.length > before.saves || validations.length > before.validations).toBe(true));
      });
      return { result };
    };
    const set = (field: keyof Values, value: string) => act(async () => api().form.setFieldValue(field, value));
    /** Renders `next` in a transition, which React abandons when it suspends. */
    const transition = (next: Shape) =>
      act(async () => {
        startTransition(() => root.render(tree({ ...shape, ...next })));
      });
    return {
      api,
      render,
      root,
      saves,
      set,
      submit,
      transition,
      validations,
    };
  }

  it('a save captured before the form unmounts is no longer current, and stays so once the form mounts again', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    const old = draft.saves[0] as Entry;
    expect(old.save.isCurrent()).toBe(true);
    await draft.render({ shown: false });
    expect(old.save.isCurrent()).toBe(false);
    // The same identity mounts again: a new form, a new mount.
    await draft.render({ shown: true, key: 'second' });
    expect(old.save.isCurrent()).toBe(false);
    await draft.set('name', 'Rounded');
    const before = draft.api().form.state.values;
    await act(async () => {
      expect(old.save.succeeded({ ...original, name: 'Pill' })).toBe(false);
      old.save.failed();
      old.finish('saved');
    });
    expect(await result).toBe('failed');
    expect(draft.api().form.state.values).toStrictEqual(before);
    expect(draft.api().baseline).toStrictEqual(original);
    expect(draft.api().isDirty).toBe(true);
    expect(draft.api().isSaving).toBe(false);
  });

  it('a save that ends after the unmount resolves failed, whatever its handler said', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    await draft.render({ shown: false });
    await act(async () => draft.saves[0]?.finish('invalid'));
    expect(await result).toBe('failed');
  });

  it('a form that unmounts without a save, mounts and unmounts again, leaves nothing behind', async () => {
    const draft = await lifetimes();
    await draft.render({ shown: false });
    await draft.render({ shown: true, key: 'second' });
    await draft.render({ shown: false });
    await draft.render({ shown: true, key: 'third' });
    expect(draft.saves).toHaveLength(0);
    expect(draft.api().isSaving).toBe(false);
    expect(draft.api().settlement()).toStrictEqual({ settled: true, generation: 0 });
  });

  it('over repeated mounts each save is current only in the mount that started it', async () => {
    const draft = await lifetimes();
    const results: Array<Promise<DraftSubmitResult>> = [];
    for (const [index, key] of ['first', 'second', 'third'].entries()) {
      if (index > 0) await draft.render({ shown: true, key });
      await draft.set('name', key);
      results.push((await draft.submit()).result);
      expect(draft.saves.map((entry) => entry.save.isCurrent())).toStrictEqual(draft.saves.map((_, i) => i === index));
      await draft.render({ shown: false });
    }
    expect(draft.saves.every((entry) => !entry.save.isCurrent())).toBe(true);
    await draft.render({ shown: true, key: 'fourth' });
    await act(async () => {
      for (const entry of draft.saves) {
        expect(entry.save.succeeded(entry.values)).toBe(false);
        entry.finish('saved');
      }
    });
    expect(await Promise.all(results)).toStrictEqual(['failed', 'failed', 'failed']);
    expect(draft.api().form.state.values).toStrictEqual(original);
  });

  it('remounted under a new key in one commit: the old save is not current, and neither save unlocks the other', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result: old } = await draft.submit();
    await draft.render({ key: 'second' });
    await draft.set('name', 'Rounded');
    const { result: fresh } = await draft.submit();
    expect(draft.saves.map((entry) => entry.save.isCurrent())).toStrictEqual([false, true]);
    await act(async () => {
      draft.saves[0]?.save.succeeded(draft.saves[0].values);
      draft.saves[0]?.finish('saved');
    });
    expect(await old).toBe('failed');
    expect(draft.api().isSaving).toBe(true);
    expect(await draft.api().submit()).toBe('busy');
    await act(async () => {
      expect(draft.saves[1]?.save.succeeded(draft.saves[1].values)).toBe(true);
      draft.saves[1]?.finish('saved');
    });
    expect(await fresh).toBe('saved');
    expect(draft.api().baseline.name).toBe('Rounded');
    expect(draft.api().isSaving).toBe(false);
  });

  it('A → B → A within one mount: the old save ends without touching the form; a save started after coming back is current', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'A1');
    const { result: first } = await draft.submit();
    await draft.render({ identity: 'site-b', source: { name: 'B', description: '' } });
    await draft.render({ identity: 'site-a', source: original });
    await draft.set('name', 'A2');
    await act(async () => {
      expect(draft.saves[0]?.save.succeeded(draft.saves[0].values)).toBe(false);
      draft.saves[0]?.finish('saved');
    });
    expect(await first).toBe('failed');
    expect(draft.api().form.state.values.name).toBe('A2');
    expect(draft.api().isSaving).toBe(false);
    const { result: second } = await draft.submit();
    expect(draft.saves.map((entry) => entry.save.isCurrent())).toStrictEqual([false, true]);
    await act(async () => {
      draft.saves[1]?.save.succeeded(draft.saves[1].values);
      draft.saves[1]?.finish('saved');
    });
    expect(await second).toBe('saved');
    expect(draft.api().settlement()).toStrictEqual({ settled: true, generation: 2 });
  });

  it('StrictMode: the mount’s setup, cleanup and setup leave the form current; a rerender while saving keeps the save current', async () => {
    const draft = await lifetimes({ strict: true });
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    expect(draft.saves[0]?.save.isCurrent()).toBe(true);
    // A refetch with the same values: a rerender, nothing else.
    await draft.render({ source: { ...original } });
    expect(draft.saves[0]?.save.isCurrent()).toBe(true);
    await act(async () => {
      expect(draft.saves[0]?.save.succeeded(draft.saves[0].values)).toBe(true);
      draft.saves[0]?.finish('saved');
    });
    expect(await result).toBe('saved');
    expect(draft.api().baseline).toStrictEqual({ ...original, name: 'Pill' });
    expect(draft.api().settlement()).toStrictEqual({ settled: true, generation: 0 });
  });

  it('StrictMode: an unmount still ends the save', async () => {
    const draft = await lifetimes({ strict: true });
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    await draft.render({ shown: false });
    await draft.render({ shown: true, key: 'second' });
    expect(draft.saves[0]?.save.isCurrent()).toBe(false);
    await act(async () => draft.saves[0]?.finish('saved'));
    expect(await result).toBe('failed');
  });

  it('a render React abandons (it suspended) ends no save of the form still on screen', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    // Would replace the form, but suspends inside a transition: React keeps what is committed.
    await draft.transition({ key: 'second', suspend: true });
    expect(draft.api('second')).toBeDefined();
    expect(draft.saves[0]?.save.isCurrent()).toBe(true);
    // The same form re-rendered in an abandoned transition stays current too.
    await draft.transition({ source: { ...original, description: 'never shown' }, suspend: true });
    expect(draft.saves[0]?.save.isCurrent()).toBe(true);
    await act(async () => {
      expect(draft.saves[0]?.save.succeeded(draft.saves[0].values)).toBe(true);
      draft.saves[0]?.finish('saved');
    });
    expect(await result).toBe('saved');
    expect(draft.api().isSaving).toBe(false);
  });

  // React runs effect cleanups when <Activity> hides a tree, as on unmount, and
  // keeps its state for when it shows again. The hook cannot tell the two apart,
  // so hiding ends the save's ownership too; only the request's end unlocks.
  it('hidden by <Activity> and shown again: the save is no longer current, and its own end still unlocks the kept form', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    await draft.render({ hidden: true });
    expect(draft.saves[0]?.save.isCurrent()).toBe(false);
    await draft.render({ hidden: false });
    expect(draft.saves[0]?.save.isCurrent()).toBe(false);
    expect(draft.api().isSaving).toBe(true);
    expect(await draft.api().submit()).toBe('busy');
    await act(async () => draft.saves[0]?.finish('saved'));
    expect(await result).toBe('failed');
    expect(draft.api().isSaving).toBe(false);
    expect(draft.api().form.state.values.name).toBe('Pill');
    const { result: next } = await draft.submit();
    expect(draft.saves[1]?.save.isCurrent()).toBe(true);
    await act(async () => draft.saves[1]?.finish('failed'));
    expect(await next).toBe('failed');
  });

  it('validation that ends after the unmount sends nothing', async () => {
    const draft = await lifetimes({ validated: true });
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    expect(draft.validations).toHaveLength(1);
    await draft.render({ shown: false });
    await act(async () => {
      draft.validations[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(draft.saves).toHaveLength(0);
    expect(await result).toBe('failed');
  });

  it('a submit handler that rejects after the unmount ends failed, with no unhandled rejection', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    await draft.render({ shown: false });
    await act(async () => draft.saves[0]?.fail(new Error('offline')));
    expect(await result).toBe('failed');
  });

  it('a submit handler that rejects while its form is current still rejects the submit, as before', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const caught = (await draft.submit()).result.catch((error: unknown) => error);
    await act(async () => draft.saves[0]?.fail(new Error('offline')));
    expect(await caught).toStrictEqual(new Error('offline'));
    expect(draft.api().isSaving).toBe(false);
  });

  it('the unmount ends the save within its own commit: an answer right after it is ignored', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    const old = draft.saves[0] as Entry;
    let seen: boolean | undefined;
    let confirmed: boolean | undefined;
    await act(async () => {
      flushSync(() => draft.root.render(null));
      // The response's continuation, queued as the unmount commits.
      await Promise.resolve().then(() => {
        seen = old.save.isCurrent();
        confirmed = old.save.succeeded(old.values);
        old.finish('saved');
      });
    });
    expect(seen).toBe(false);
    expect(confirmed).toBe(false);
    expect(await result).toBe('failed');
  });

  it('an answer that lands just before the unmount counts for the form it reached; its submit, ending after, says failed', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const { result } = await draft.submit();
    const old = draft.saves[0] as Entry;
    await act(async () => {
      expect(old.save.succeeded(old.values)).toBe(true);
      flushSync(() => draft.root.render(null));
      old.finish('saved');
    });
    expect(await result).toBe('failed');
  });

  it('submit on a form that already unmounted starts nothing', async () => {
    const draft = await lifetimes();
    await draft.set('name', 'Pill');
    const stale = draft.api();
    await draft.render({ shown: false });
    expect(await stale.submit()).toBe('failed');
    expect(draft.saves).toHaveLength(0);
  });
});
