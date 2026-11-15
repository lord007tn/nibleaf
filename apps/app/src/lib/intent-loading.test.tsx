// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { HydrationIsland, hydrationModule } from './hydration-modules';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let container: HTMLDivElement | undefined;

// Transform the menu's code up front so a cold import can't outlast `act`.
beforeAll(async () => {
  await import('@/components/site/header-menus');
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

it('renders the header language menu as its trigger alone, and opens the menu a click asked for once it loads', async () => {
  Element.prototype.getAnimations = vi.fn(() => []);
  const languages = [
    { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true },
    { code: 'ar', label: 'العربية', direction: 'RTL' as const, isDefault: false },
  ];
  const onChange = vi.fn();
  const element = <LanguageSwitcher languages={languages} activeCode="en" onChange={onChange} />;
  container = document.createElement('div');
  container.innerHTML = renderToString(element);
  document.body.append(container);
  const serverTrigger = container.querySelector<HTMLButtonElement>('button');
  expect(serverTrigger?.getAttribute('aria-haspopup')).toBe('menu');
  expect(serverTrigger?.textContent).toContain('English');

  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, element, { onRecoverableError: (error) => errors.push(error) });
  });
  expect(errors).toEqual([]);
  // Hydrated as sent: the server's own button, no menu code rendered yet.
  expect(container.querySelector('button')).toBe(serverTrigger);

  await act(async () => serverTrigger?.click());
  await settle();
  // The language menu is a radio menu: its items announce which language is current.
  const arabic = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === 'العربية');
  expect(arabic).toBeDefined();
  await act(async () => arabic?.click());
  expect(onChange).toHaveBeenCalledWith('ar');
});

it('loads an intent island only when the reader reaches for it, then replays the click', async () => {
  const onClick = vi.fn();
  let downloads = 0;
  const module = hydrationModule('test-intent', async () => {
    downloads++;
    return { onClick };
  });
  const modules = [module];
  function Card({ live }: { live: boolean }) {
    const [count, setCount] = useState(0);
    return (
      <aside>
        <p>Ask about this page</p>
        <button
          type="button"
          onClick={() => {
            setCount(count + 1);
            if (live) module.read().onClick();
          }}
        >
          Ask {count}
        </button>
      </aside>
    );
  }
  // The server's markup: the island (its id as React hydrates it) holding the
  // card the server rendered once the module had loaded there.
  container = document.createElement('div');
  container.innerHTML = renderToString(
    <HydrationIsland loadOnIntent modules={modules}>
      {() => null}
    </HydrationIsland>,
  );
  const id = container.firstElementChild?.getAttribute('data-hydration-island') ?? '';
  // Built with DOM APIs, so the island id is never parsed as HTML.
  const island = document.createElement('div');
  island.setAttribute('data-hydration-island', id);
  island.innerHTML = '<aside><p>Ask about this page</p><button type="button">Ask 0</button></aside>';
  container.replaceChildren(island);
  document.body.append(container);

  await act(async () => {
    root = hydrateRoot(
      container as HTMLDivElement,
      <HydrationIsland loadOnIntent modules={modules}>
        {() => <Card live />}
      </HydrationIsland>,
    );
  });
  await settle();
  expect(downloads).toBe(0);
  expect(container.textContent).toContain('Ask 0');

  await act(async () => container?.querySelector('button')?.click());
  await settle();
  expect(downloads).toBe(1);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Ask 1');
});

it('loads an intent island at once when it renders on the client', async () => {
  let downloads = 0;
  const module = hydrationModule('test-client', async () => {
    downloads++;
    return 'ready';
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <HydrationIsland loadOnIntent modules={[module]}>
        {() => <p>{module.read()}</p>}
      </HydrationIsland>,
    ),
  );
  await settle();
  expect(downloads).toBe(1);
  expect(container.textContent).toBe('ready');
});
