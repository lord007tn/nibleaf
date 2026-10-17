// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('@nibleaf/i18n/standalone', () => ({ useStandaloneT: () => (key: string) => key }));

import { ErrorPage } from './error-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('error-page retry', () => {
  it('reloads failed route data before resetting the boundary', async () => {
    let finish: (() => void) | undefined;
    mocks.invalidate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const reset = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ErrorPage error={new Error('Too many requests, please slow down.')} reset={reset} />));
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'error.tryAgain');
    if (!retry) throw new Error('Missing retry control');
    await act(async () => retry.click());
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    if (!finish) throw new Error('Missing route reload completion');
    await act(async () => finish?.());
    expect(reset).toHaveBeenCalledOnce();
  });
});
