// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePageTitle } from './use-page-title';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function Titled({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

// Sol review of #643: a dashboard title stayed on /app/welcome after navigating there.
it('gives the previous title back when the page that set it goes away', async () => {
  document.title = 'Nibleaf Cloud — documentation workspace';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root?.render(<Titled title="General · Documentation · Nibleaf" />));
  expect(document.title).toBe('General · Documentation · Nibleaf');
  await act(async () => root?.render(<Titled title="Domain · Documentation · Nibleaf" />));
  expect(document.title).toBe('Domain · Documentation · Nibleaf');
  // Navigating to a page that sets no title of its own.
  await act(async () => root?.render(null));
  expect(document.title).toBe('Nibleaf Cloud — documentation workspace');
});

it('hands over from one titled page to the next without a stale title', async () => {
  document.title = 'Fallback';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root?.render(<Titled key="account" title="Account · Account settings · Nibleaf" />));
  await act(async () => root?.render(<Titled key="welcome" title="Create your organization · Nibleaf" />));
  expect(document.title).toBe('Create your organization · Nibleaf');
});

// Sol review of #643: leaving the dashboard for a reader page restored the
// dashboard's fallback over the article title the reader's head had just set.
it('leaves a title that another page set in the meantime', async () => {
  document.title = 'Nibleaf Cloud — documentation workspace';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root?.render(<Titled title="Overview · Documentation · Nibleaf" />));
  // The reader's head sets its article title during the same commit.
  document.title = 'Getting started — Documentation';
  await act(async () => root?.render(null));
  expect(document.title).toBe('Getting started — Documentation');
});

// Sol re-check 2 of #643: a reader page whose SEO title is the same text as the
// dashboard's lost it to the dashboard's fallback. TanStack's HeadContent
// renders the route title as a React `<title>`; this does the same.
function HeadTitle({ text }: { text: string }) {
  return createPortal(<title>{text}</title>, document.head);
}

it('leaves a title another page set to the very same text', async () => {
  document.head.replaceChildren();
  root = createRoot(document.body.appendChild(document.createElement('div')));
  const same = 'Overview · Documentation · Nibleaf';
  await act(async () =>
    root?.render(
      <>
        <HeadTitle text="Nibleaf Cloud — documentation workspace" />
        <Titled title={same} />
      </>,
    ),
  );
  expect(document.title).toBe(same);
  // One commit: the dashboard goes, and the reader's head sets the same text.
  await act(async () => root?.render(<HeadTitle text={same} />));
  expect(document.title).toBe(same);
});

it('still gives the title back in StrictMode', async () => {
  document.head.replaceChildren();
  document.title = 'Fallback';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () =>
    root?.render(
      <StrictMode>
        <Titled title="Members · Ada's workspace · Nibleaf" />
      </StrictMode>,
    ),
  );
  expect(document.title).toBe("Members · Ada's workspace · Nibleaf");
  await act(async () => root?.render(<StrictMode>{null}</StrictMode>));
  expect(document.title).toBe('Fallback');
});
