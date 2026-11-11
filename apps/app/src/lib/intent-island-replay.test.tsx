// @vitest-environment jsdom
import { act, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { HydrationIsland, hydrationModule } from './hydration-modules';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
});

const settle = () =>
  act(async () => {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** An intent island whose module downloads only when the test releases it. */
async function gatedIsland(key: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onClick = vi.fn();
  const module = hydrationModule(key, async () => {
    await gate;
    return { onClick };
  });
  function Card() {
    const [count, setCount] = useState(0);
    return (
      <aside>
        <button
          type="button"
          onClick={() => {
            setCount(count + 1);
            module.read().onClick();
          }}
        >
          Ask {count}
        </button>
      </aside>
    );
  }
  container = document.createElement('div');
  container.innerHTML = renderToString(
    <HydrationIsland loadOnIntent modules={[module]}>
      {() => null}
    </HydrationIsland>,
  );
  const id = container.firstElementChild?.getAttribute('data-hydration-island') ?? '';
  const island = document.createElement('div');
  island.setAttribute('data-hydration-island', id);
  island.innerHTML = '<aside><button type="button">Ask 0</button></aside>';
  container.replaceChildren(island);
  const outside = document.createElement('button');
  outside.textContent = 'Elsewhere';
  document.body.append(container, outside);
  await act(async () => {
    root = hydrateRoot(
      container as HTMLDivElement,
      <HydrationIsland loadOnIntent modules={[module]}>
        {() => <Card />}
      </HydrationIsland>,
    );
  });
  const serverButton = () => container?.querySelector('button') as HTMLButtonElement;
  return { release, onClick, serverButton, outside };
}

it('replays a click that follows focus while the module is still downloading (keyboard and pointer)', async () => {
  const { release, onClick, serverButton } = await gatedIsland('replay-focus-click');
  await act(async () => serverButton().focus());
  await act(async () => serverButton().click());
  await act(async () => release());
  await settle();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(container?.textContent).toContain('Ask 1');
  // The island still owned focus, so the live button takes it over.
  expect(document.activeElement).toBe(container?.querySelector('button'));
});

it('leaves focus where the reader moved it before the module arrived', async () => {
  const { release, onClick, serverButton, outside } = await gatedIsland('replay-focus-left');
  await act(async () => serverButton().focus());
  await act(async () => outside.focus());
  await act(async () => release());
  await settle();
  expect(document.activeElement).toBe(outside);
  expect(onClick).not.toHaveBeenCalled();
});
