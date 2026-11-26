// @vitest-environment jsdom
// The Ghost import in ImportTab, from reading the chosen file to sending the import. Real QueryClient (the app's own),
// the real mutation and the real component; only the HTTP calls are replaced and held until the test answers them,
// and FileReader is replaced by one the test finishes, fails or aborts by hand.
//
// Which cases ordinary use reaches: a double press during a slow read, choosing another source chip or file during
// the read, leaving for another site (the settings page keys the tab by site, so that is an unmount), A → B → A with
// the source chips, and switching source while the request runs. A site change on the *same* instance is not
// reachable through the settings page; those tests are programmatic identity checks.
import { translateFn } from '@nibleaf/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  ghost: vi.fn(),
  mintlify: vi.fn(),
  gitbook: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className} href="#settings">
      {children}
    </a>
  ),
}));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useT: () => (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, mocks.locale),
  };
});
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          settings: { import: { ghost: { $post: mocks.ghost }, mintlify: { $post: mocks.mintlify }, gitbook: { $post: mocks.gitbook } } },
        },
      },
    },
  },
}));

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ImportTab } from './import-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/** A FileReader the test finishes by hand. Each `readAsText` is one read; nothing happens until the test says so. */
class HeldReader {
  static reads: HeldReader[] = [];
  onload: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onabort: ((event: unknown) => void) | null = null;
  result: string | null = null;
  readyState = 0;
  file: File | null = null;
  /** Aborted by the component (not by the test). */
  abortedByOwner = false;
  readAsText(file: File) {
    this.file = file;
    this.readyState = 1;
    HeldReader.reads.push(this);
  }
  abort() {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this.abortedByOwner = !this.onabort;
    this.onabort?.({});
  }
  async finish(text: string) {
    await act(async () => {
      if (this.readyState !== 1) return;
      this.readyState = 2;
      this.result = text;
      this.onload?.({});
    });
    await settle();
  }
  async fail() {
    await act(async () => {
      this.readyState = 2;
      this.onerror?.({});
    });
    await settle();
  }
  /** The browser (or anything but the component) aborts the read. */
  async abortExternally() {
    await act(async () => this.abort());
    await settle();
  }
  get detached() {
    return !this.onload && !this.onerror && !this.onabort;
  }
}
vi.stubGlobal('FileReader', HeldReader);

const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SUMMARY = { imported: 2, updated: 0, skipped: 1, warnings: [] };
const ok = () => json(200, { data: SUMMARY });
/** Lets mutations settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {
    promise,
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
    drop: async (error: unknown) => {
      await act(async () => reject(error));
      await settle();
    },
  };
}

/** A fictional Ghost export: the importer reads `db[0].data`. */
const EXPORT = { db: [{ meta: { version: '5.0.0' }, data: { posts: [{ id: '1', title: 'Hello', status: 'published' }] } }] };
const exportFile = (name = 'handbook.ghost.json', text = JSON.stringify(EXPORT)) => new File([text], name, { type: 'application/json' });
const ghostBody = (ghostUrl = 'https://blog.example.com') => ({ ...EXPORT, __nibleafImport: { ghostUrl } });

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];

const render = async (node: ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
const tab = (projectId: string | undefined, key?: string) => render(<ImportTab key={key} projectId={projectId} />);

const buttons = () => [...container.querySelectorAll('button')];
/** A source in the picker, found by its label. */
const chip = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (item) => document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() === label,
  );
/** The error shown under a field, by the field's id. */
const fieldError = (id: string) => container.querySelector(`#${id}-error`)?.textContent ?? '';
/** The Import button: its running text is always in the markup (hidden while idle). */
const importButton = () => buttons().find((item) => item.textContent?.includes(t('settings.import.running')));
const press = async (element: HTMLElement | undefined) => {
  await act(async () => element?.click());
  await settle();
};
const chooseSource = (label: string) => press(chip(label));
const type = async (selector: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const chooseFile = async (file: File | null) => {
  const input = container.querySelector<HTMLInputElement>('#import-ghost-file');
  if (!input) throw new Error('no file input');
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
};
/** Ghost chosen, a URL typed (with spaces, as people paste it; a url input sanitizes them) and a file picked. */
const readyGhost = async (file = exportFile(), url = '  https://blog.example.com  ') => {
  await chooseSource('Ghost');
  await type('#import-ghost-url', url);
  await chooseFile(file);
  return file;
};
const isBusy = (button = importButton()) => button?.getAttribute('aria-busy') === 'true';
const isDisabled = (button = importButton()) => Boolean(button?.disabled || button?.getAttribute('aria-disabled') === 'true');
const posts = () => mocks.ghost.mock.calls.map(([request]) => request);
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const showsResult = () => buttons().some((item) => item.textContent?.trim() === t('settings.import.again'));
const read = () => {
  const reader = HeldReader.reads.at(-1);
  if (!reader) throw new Error('nothing is being read');
  return reader;
};

beforeEach(() => {
  mocks.locale = 'en';
  HeldReader.reads = [];
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.ghost.mockReset().mockImplementation(async () => ok());
  mocks.mintlify.mockReset();
  mocks.gitbook.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('the Import page asks where the content lives first', () => {
  it('leads with the source picker, and shows no form or Import button until a source is chosen', async () => {
    await tab('site-a');
    expect(container.querySelector('h1')?.textContent).toBe(t('settings.import.title'));
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(container.querySelector('#import-repo')).toBeNull();
    expect(importButton()).toBeUndefined();
    await chooseSource('Mintlify');
    expect(chip('Mintlify')?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('#import-repo')).not.toBeNull();
    expect(importButton()).toBeDefined();
  });

  it('sends a Git repository to the Git page, with no import form here', async () => {
    await tab('site-a');
    await chooseSource(t('settings.import.git.title'));
    expect([...container.querySelectorAll('a')].some((link) => link.textContent?.includes(t('settings.import.git.open')))).toBe(true);
    expect(importButton()).toBeUndefined();
  });

  it('asks for the Ghost export file under the file field instead of reading or sending', async () => {
    await tab('site-a');
    await chooseSource('Ghost');
    await type('#import-ghost-url', 'https://blog.example.com');
    await press(importButton());
    expect(fieldError('import-ghost-file')).toBe(t('settings.import.ghost.fileRequired'));
    expect(document.activeElement?.id).toBe('import-ghost-file-button');
    expect(HeldReader.reads).toHaveLength(0);
    expect(posts()).toHaveLength(0);
    expect(errors()).toEqual([]);
    await chooseFile(exportFile());
    expect(fieldError('import-ghost-file')).toBe('');
  });
});

describe('after an import', () => {
  it('starts at the result after Import, and back at the source picker after Import another, with old errors gone', async () => {
    await tab('site-a');
    await readyGhost();
    mocks.ghost.mockImplementationOnce(async () => json(400, { error: { code: 'import:invalid_document', message: 'Not a Ghost export' } }));
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(fieldError('import-ghost-file')).toBe(t('settings.import.ghost.invalidJson'));
    // The error is in the field's description when focus lands there.
    expect(document.activeElement?.getAttribute('aria-describedby')).toContain('import-ghost-file-error');
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(showsResult()).toBe(true);
    expect(document.activeElement?.textContent).toBe(t('settings.import.success'));
    await press(buttons().find((item) => item.textContent?.trim() === t('settings.import.again')));
    expect(document.activeElement?.textContent).toBe(t('settings.import.workspace.emptyTitle'));
    expect(fieldError('import-ghost-file')).toBe('');
  });

  it('keeps the import note under every source form, Ghost included', async () => {
    await tab('site-a');
    await chooseSource('Ghost');
    expect(container.textContent).toContain(t('settings.import.summaryHint'));
  });
});

describe('one owner from reading a Ghost file to sending the import', () => {
  it('sends the export as read, with its site, the trimmed URL and the import metadata', async () => {
    await tab('site-a');
    const file = await readyGhost();
    await press(importButton());
    expect(read().file).toBe(file);
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: ghostBody() }]);
    expect(refreshed()).toEqual([queryKeys.pages.allForProject('site-a')]);
    expect(mocks.success).toHaveBeenCalledWith(t('settings.import.success'));
    expect(showsResult()).toBe(true);
  });

  it('reads and sends once for presses in the same tick, and stays busy (keeping focus) from the read to the answer', async () => {
    await tab('site-a');
    await readyGhost();
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    const button = importButton();
    button?.focus();
    await act(async () => {
      button?.click();
      button?.click();
    });
    await settle();
    await press(importButton());
    expect(HeldReader.reads).toHaveLength(1);
    // Reading the file is part of the import the person asked for: busy, with the existing "Importing…".
    expect(isBusy()).toBe(true);
    expect(importButton()?.disabled).toBe(false);
    expect(importButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(read().detached).toBe(true);
    expect(isBusy()).toBe(true);
    await press(importButton());
    expect(posts()).toHaveLength(1);
    await answer.answer(ok());
    expect(posts()).toHaveLength(1);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('refuses a file over 15 MiB before reading it', async () => {
    await tab('site-a');
    const file = exportFile();
    Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
    await readyGhost(file);
    await press(importButton());
    expect(HeldReader.reads).toHaveLength(0);
    // Said under the file, not as a toast.
    expect(errors()).toEqual([]);
    expect(fieldError('import-ghost-file')).toBe(t('settings.import.ghost.tooLarge'));
    expect(isBusy()).toBe(false);
  });

  it('refuses a URL with credentials or another protocol before reading', async () => {
    await tab('site-a');
    await readyGhost(exportFile(), 'https://user:secret@blog.example.com');
    await press(importButton());
    expect(fieldError('import-ghost-url')).toBe(t('settings.import.ghost.invalidUrl'));
    expect(document.activeElement?.id).toBe('import-ghost-url');
    await type('#import-ghost-url', 'ftp://blog.example.com');
    // Typing clears the error until the next press.
    expect(fieldError('import-ghost-url')).toBe('');
    await press(importButton());
    expect(HeldReader.reads).toHaveLength(0);
    expect(fieldError('import-ghost-url')).toBe(t('settings.import.ghost.invalidUrl'));
    expect(errors()).toEqual([]);
  });

  it.each([
    ['fails', (reader: HeldReader) => reader.fail()],
    ['is aborted', (reader: HeldReader) => reader.abortExternally()],
  ])('reports a read that %s as a failed import, not as invalid JSON, and keeps the file and URL for a retry', async (_case, end) => {
    await tab('site-a');
    const file = await readyGhost();
    await press(importButton());
    await end(read());
    expect(errors()).toEqual([t('settings.import.error')]);
    expect(read().detached).toBe(true);
    expect(posts()).toHaveLength(0);
    expect(isBusy()).toBe(false);
    expect(isDisabled()).toBe(false);
    expect(container.querySelector<HTMLInputElement>('#import-ghost-url')?.value).toBe('https://blog.example.com');
    await press(importButton());
    expect(read().file).toBe(file);
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: ghostBody() }]);
  });

  it.each([
    ['not JSON', '{"db": ['],
    ['JSON but not an object', '[{"db": []}]'],
    ['a JSON string', '"ghost"'],
  ])('refuses a file that is %s as invalid JSON, once, and sends nothing', async (_case, text) => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    await read().finish(text);
    expect(fieldError('import-ghost-file')).toBe(t('settings.import.ghost.invalidJson'));
    expect(errors()).toEqual([]);
    expect(posts()).toHaveLength(0);
    expect(isBusy()).toBe(false);
    expect(isDisabled()).toBe(false);
  });

  it('retires a read when another source is chosen, and sends nothing for it', async () => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    const reader = read();
    await chooseSource('Mintlify');
    expect(isBusy()).toBe(false);
    await reader.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(reader.detached).toBe(true);
    expect(reader.abortedByOwner).toBe(true);
  });

  it('retires a read when Ghost is left and opened again (A → B → A), even with the same file and URL', async () => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    const reader = read();
    await chooseSource('Mintlify');
    await chooseSource('Ghost');
    expect(isBusy()).toBe(false);
    await reader.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    // A new press is a new import of what is chosen now.
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: ghostBody() }]);
  });

  it('retires a read when another file is chosen, or the URL changes', async () => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    const first = read();
    await chooseFile(exportFile('other.json'));
    await first.finish(JSON.stringify(EXPORT));
    await press(importButton());
    const second = read();
    await type('#import-ghost-url', 'https://news.example.com');
    await second.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    expect(mocks.error).not.toHaveBeenCalled();
    await press(importButton());
    expect(read().file?.name).toBe('other.json');
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: ghostBody('https://news.example.com') }]);
  });

  it('retires a read when the tab leaves for another site (keyed, as the settings page mounts it)', async () => {
    await tab('site-a', 'import-site-a');
    await readyGhost();
    await press(importButton());
    const reader = read();
    await tab('site-b', 'import-site-b');
    await reader.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    expect(reader.abortedByOwner).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('retires a read when the tab unmounts', async () => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    const reader = read();
    await render(null);
    await reader.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('programmatic: retires a read when the same instance moves to another site, and back (A → B → A)', async () => {
    await tab('site-a');
    await readyGhost();
    await press(importButton());
    const first = read();
    await tab('site-b');
    await first.finish(JSON.stringify(EXPORT));
    await press(importButton());
    const second = read();
    await tab('site-a');
    await tab('site-b');
    await tab('site-a');
    await second.finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(0);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('keeps an accepted import running after the view moves on: its own site is refreshed, and nothing replaces the new panel', async () => {
    await tab('site-a');
    await readyGhost();
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toHaveLength(1);
    await chooseSource('Mintlify');
    await answer.answer(ok());
    expect(refreshed()).toEqual([queryKeys.pages.allForProject('site-a')]);
    expect(showsResult()).toBe(false);
    expect(container.querySelector('#import-repo')).not.toBeNull();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('shows Ghost busy while its import runs after A → B → A, and does not report into the reopened panel', async () => {
    await tab('site-a');
    await readyGhost();
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    await chooseSource('Mintlify');
    await chooseSource('Ghost');
    expect(isBusy()).toBe(true);
    await press(importButton());
    expect(HeldReader.reads).toHaveLength(1);
    await answer.drop(new TypeError('fetch failed'));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it('shows the site busy after a keyed remount while its import still runs, and refreshes only that site', async () => {
    await tab('site-a', 'import-site-a');
    await readyGhost();
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    await tab('site-b', 'import-site-b');
    await chooseSource('Ghost');
    expect(isBusy()).toBe(false);
    await tab('site-a', 'import-site-a-again');
    await chooseSource('Ghost');
    expect(isBusy()).toBe(true);
    await answer.answer(ok());
    expect(refreshed()).toEqual([queryKeys.pages.allForProject('site-a')]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it('programmatic: refreshes the site it was sent for when the same instance has moved to another', async () => {
    await tab('site-a');
    await readyGhost();
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    await tab('site-b');
    await answer.answer(ok());
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: ghostBody() }]);
    expect(refreshed()).toEqual([queryKeys.pages.allForProject('site-a')]);
    expect(showsResult()).toBe(false);
  });

  it('reports a current refusal once, keeps the file and URL, and sends the same body on retry', async () => {
    await tab('site-a');
    await readyGhost();
    mocks.ghost.mockImplementationOnce(async () => json(400, { error: { code: 'import:invalid_document', message: 'Not a Ghost export' } }));
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(fieldError('import-ghost-file')).toBe(t('settings.import.ghost.invalidJson'));
    expect(errors()).toEqual([]);
    expect(isBusy()).toBe(false);
    expect(isDisabled()).toBe(false);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(posts()).toEqual([
      { param: { projectId: 'site-a' }, json: ghostBody() },
      { param: { projectId: 'site-a' }, json: ghostBody() },
    ]);
    expect(showsResult()).toBe(true);
  });

  it.each([
    ['a gateway timeout', async () => json(504, { error: { message: 'Gateway Timeout' } })],
    ['a dropped connection', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('says the import may still be running after %s, for 20 seconds', async (_case, answer) => {
    await tab('site-a');
    await readyGhost();
    mocks.ghost.mockImplementationOnce(answer);
    await press(importButton());
    await read().finish(JSON.stringify(EXPORT));
    expect(mocks.error.mock.calls).toEqual([[t('settings.import.mayStillRun'), { duration: 20_000 }]]);
    expect(posts()).toHaveLength(1);
  });

  it('keeps the existing Arabic copy for busy and a read failure', async () => {
    mocks.locale = 'ar';
    await tab('site-a');
    await chooseSource('Ghost');
    await type('#import-ghost-url', 'https://blog.example.com');
    await chooseFile(exportFile());
    await press(importButton());
    expect(importButton()?.textContent).toContain('جارٍ الاستيراد…');
    expect(isBusy()).toBe(true);
    await read().fail();
    expect(errors()).toEqual(['فشل الاستيراد']);
  });
});
