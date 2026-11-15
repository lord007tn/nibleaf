// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteReaderContext, SiteReaderPending } from './site-reader-context';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

describe('SiteReaderPending', () => {
  it('renders the skeleton the reader chrome hands down, in the same render', async () => {
    const container = await render(
      <SiteReaderContext.Provider value={{ homeHref: '/sites/qa', pendingArticle: () => <p data-site-article-skeleton>loading</p> }}>
        <SiteReaderPending />
      </SiteReaderContext.Provider>,
    );
    expect(container.querySelector('[data-site-article-skeleton]')?.textContent).toBe('loading');
  });

  it('renders nothing outside the reader chrome', async () => {
    const container = await render(<SiteReaderPending />);
    expect(container.innerHTML).toBe('');
  });

  it('imports nothing beyond React, because it sits in every page entry chunk', () => {
    const source = readFileSync('src/components/site/site-reader-context.tsx', 'utf8');
    expect([...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1])).toEqual(['react']);
  });
});
