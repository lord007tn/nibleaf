// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DraftSave, useServerDraftForm } from './use-server-draft';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Values = { name: string };
type Api = ReturnType<typeof useServerDraftForm<Values>>;

function Harness({
  identity,
  source,
  onSubmit,
  expose,
}: {
  identity: string;
  source: Values;
  onSubmit: (values: Values, save: DraftSave<Values>) => Promise<void>;
  expose: (api: Api) => void;
}) {
  const api = useServerDraftForm<Values>({ identity: [identity], source, onSubmit });
  expose(api);
  return null;
}

/** Starts a submit and lets validation run until `onSubmit` has been called (the save itself stays pending). */
const startSubmit = (api: Api) =>
  act(async () => {
    void api.form.handleSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

async function mount() {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  let api!: Api;
  const saves: Array<{ values: Values; save: DraftSave<Values>; settle: () => void }> = [];
  const onSubmit = (values: Values, save: DraftSave<Values>) =>
    new Promise<void>((resolve) => {
      saves.push({ values, save, settle: resolve });
    });
  const render = (identity: string, source: Values) =>
    act(async () =>
      root.render(
        <Harness
          expose={(next) => {
            api = next;
          }}
          identity={identity}
          onSubmit={onSubmit}
          source={source}
        />,
      ),
    );
  return { render, saves, api: () => api };
}

describe('useServerDraftForm', () => {
  it('ignores a save that settles after switching to another site and back (A → B → A)', async () => {
    const { render, saves, api } = await mount();
    await render('site-a', { name: 'A' });
    await act(async () => api().form.setFieldValue('name', 'A edited'));
    await startSubmit(api());
    expect(saves).toHaveLength(1);

    await render('site-b', { name: 'B' });
    expect(api().form.state.values.name).toBe('B');
    await render('site-a', { name: 'A' });
    expect(api().form.state.values.name).toBe('A');
    await act(async () => api().form.setFieldValue('name', 'A again'));

    // The first save finally reports success: it must not move the new A form's baseline or values.
    const first = saves[0];
    await act(async () => {
      expect(first?.save.isCurrent()).toBe(false);
      first?.save.succeeded({ name: 'A edited' });
      first?.settle();
    });
    expect(api().form.state.values.name).toBe('A again');
    expect(api().baseline).toEqual({ name: 'A' });
    expect(api().isDirty).toBe(true);
  });

  it('applies a save that settles on the same identity', async () => {
    const { render, saves, api } = await mount();
    await render('site-a', { name: 'A' });
    await act(async () => api().form.setFieldValue('name', 'A edited'));
    await startSubmit(api());
    await act(async () => {
      expect(saves[0]?.save.isCurrent()).toBe(true);
      saves[0]?.save.succeeded({ name: 'A edited' });
      saves[0]?.settle();
    });
    expect(api().baseline).toEqual({ name: 'A edited' });
    expect(api().isDirty).toBe(false);
  });
});
