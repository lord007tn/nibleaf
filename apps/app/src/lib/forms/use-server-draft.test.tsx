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
