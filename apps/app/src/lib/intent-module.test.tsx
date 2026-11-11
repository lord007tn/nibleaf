// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { IntentTrigger } from '@/components/site/intent-trigger';
import { intentModule, useIntentModule } from './intent-module';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const settle = () =>
  act(async () => {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

it('says a deferred control could not open, and opens it when the reader tries again', async () => {
  let attempts = 0;
  const module = intentModule(async () => {
    attempts++;
    if (attempts === 1) throw new Error('chunk failed');
    return { Menu: () => <div role="menu">Languages</div> };
  });
  function Control() {
    const { loaded, trigger, failed } = useIntentModule(module);
    if (loaded) return <loaded.Menu />;
    return (
      <IntentTrigger failed={failed} lang="en">
        <button type="button" aria-haspopup="menu" {...trigger}>
          English
        </button>
      </IntentTrigger>
    );
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Control />));
  const status = () => container?.querySelector('[role="status"]')?.textContent ?? '';
  expect(status()).toBe('');

  // The reader opens it and the download fails: they are told, not left with an inert button.
  await act(async () => container?.querySelector('button')?.click());
  await settle();
  expect(module.status()).toBe('failed');
  expect(status()).toBe("Couldn't open. Select it again to try again.");
  expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(false);

  // Selecting it again retries, and the control opens.
  await act(async () => container?.querySelector('button')?.click());
  await settle();
  expect(attempts).toBe(2);
  expect(container.querySelector('[role="menu"]')?.textContent).toBe('Languages');
});

it('marks the trigger busy only while a download the reader asked for is running', async () => {
  let release!: () => void;
  const module = intentModule(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { Menu: () => <div role="menu">Versions</div> };
  });
  function Control() {
    const { loaded, trigger, failed } = useIntentModule(module);
    if (loaded) return <loaded.Menu />;
    return (
      <IntentTrigger failed={failed}>
        <button type="button" {...trigger}>
          v2
        </button>
      </IntentTrigger>
    );
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Control />));
  await act(async () => container?.querySelector('button')?.click());
  expect(container.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => release());
  await settle();
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
});
