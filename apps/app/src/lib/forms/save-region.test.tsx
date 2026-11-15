// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SaveRegionForm, SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from './save-region';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Outcome = Awaited<ReturnType<SaveRegionForm['submit']>>;

/** A registered form with two single-line fields (so HTML needs a default button for Enter) and a fake save. */
function TestForm({ id, form, invalid = false, children }: { id: string; form: SaveRegionForm; invalid?: boolean; children?: ReactNode }) {
  const formProps = useSaveRegionForm(id, form);
  return (
    <form aria-label={id} noValidate {...formProps}>
      <SaveRegionSubmit />
      <input aria-invalid={invalid || undefined} aria-label={`${id} first`} />
      <input aria-label={`${id} second`} />
      {children}
    </form>
  );
}

const fakeForm = (overrides: Partial<SaveRegionForm> = {}): SaveRegionForm => ({
  isDirty: true,
  isSubmitting: false,
  submit: vi.fn(async (): Promise<Outcome> => 'saved'),
  discard: vi.fn(),
  ...overrides,
});

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = (node: ReactNode) => act(async () => root.render(<SaveRegionProvider>{node}</SaveRegionProvider>));
const formNamed = (id: string) => container.querySelector<HTMLFormElement>(`form[aria-label="${id}"]`) as HTMLFormElement;
/** What implicit submission does once the form has a default button: the browser clicks it. */
const pressEnterIn = (id: string) => act(async () => formNamed(id).querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
const status = () => container.querySelector('[role="status"]')?.textContent;
/** The bar's Save (its last button; it reads "Saving…" while a save runs). */
const barSave = () => [...container.querySelectorAll<HTMLButtonElement>('[data-slot="save-region"] button')].at(-1) as HTMLButtonElement;

describe('SaveRegionSubmit', () => {
  it('is the form’s one default button, hidden so it is never a Tab stop or announced', async () => {
    await render(<TestForm form={fakeForm()} id="a" />);
    const buttons = formNamed('a').querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.form).toBe(formNamed('a'));
    expect(button.hidden).toBe(true);
    expect(button.textContent).toBe('common.save');
  });
});

describe('useSaveRegionForm submit', () => {
  it('saves only the form Enter was pressed in, and says so', async () => {
    const a = fakeForm();
    const b = fakeForm();
    await render(
      <>
        <TestForm form={a} id="a" />
        <TestForm form={b} id="b" />
      </>,
    );
    await pressEnterIn('b');
    expect(b.submit).toHaveBeenCalledTimes(1);
    expect(a.submit).not.toHaveBeenCalled();
    expect(status()).toBe('common.saved');
  });

  it('sends nothing from a clean form', async () => {
    const a = fakeForm({ isDirty: false });
    const b = fakeForm();
    await render(
      <>
        <TestForm form={a} id="a" />
        <TestForm form={b} id="b" />
      </>,
    );
    await pressEnterIn('a');
    expect(a.submit).not.toHaveBeenCalled();
    expect(b.submit).not.toHaveBeenCalled();
  });

  it('focuses the first invalid field of its own form, not another form’s', async () => {
    const a = fakeForm();
    const b = fakeForm({ submit: vi.fn(async (): Promise<Outcome> => 'invalid') });
    await render(
      <>
        <TestForm form={a} id="a" invalid />
        <TestForm form={b} id="b" invalid />
      </>,
    );
    await pressEnterIn('b');
    expect(document.activeElement).toBe(container.querySelector('[aria-label="b first"]'));
    expect(status()).toBe('forms.fixHighlighted');
    expect(a.submit).not.toHaveBeenCalled();
  });

  it('keeps a failed form dirty and announces nothing', async () => {
    const a = fakeForm({ submit: vi.fn(async (): Promise<Outcome> => 'failed') });
    await render(<TestForm form={a} id="a" />);
    await pressEnterIn('a');
    expect(a.submit).toHaveBeenCalledTimes(1);
    expect(status()).toBe('');
    expect(container.querySelector('[data-slot="save-region"]')).not.toBeNull();
  });

  it('starts nothing new while a save runs: Enter again, Save and Ctrl+S wait for it', async () => {
    let finish: (outcome: Outcome) => void = () => undefined;
    const a = fakeForm({
      submit: vi.fn(
        () =>
          new Promise<Outcome>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await render(<TestForm form={a} id="a" />);
    await pressEnterIn('a');
    await pressEnterIn('a');
    await act(async () => barSave().click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    expect(a.submit).toHaveBeenCalledTimes(1);
    await act(async () => finish('saved'));
    expect(status()).toBe('common.saved');
  });

  it('ignores a submit from a form portaled inside it (a dialog), leaving that form its own submit', async () => {
    const a = fakeForm();
    const dialogSubmit = vi.fn((event: { defaultPrevented: boolean; preventDefault: () => void }) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    await render(
      <TestForm form={a} id="a">
        {createPortal(
          <form aria-label="dialog" onSubmit={dialogSubmit}>
            <button type="submit">ok</button>
          </form>,
          document.body,
        )}
      </TestForm>,
    );
    await act(async () => document.querySelector<HTMLButtonElement>('form[aria-label="dialog"] button')?.click());
    expect(dialogSubmit).toHaveBeenCalledTimes(1);
    expect(a.submit).not.toHaveBeenCalled();
  });
});

describe('which Enter saves', () => {
  /** A keydown, then the default-button click the browser's implicit submission makes in the same task. */
  const enterThenSubmit = async (target: Element, init: KeyboardEventInit) => {
    const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    await act(async () => {
      target.dispatchEvent(keydown);
      formNamed('a').querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    return keydown;
  };
  const field = () => container.querySelector('[aria-label="a first"]') as HTMLInputElement;

  it('plain Enter in a single-line field saves, and leaves the key to the browser', async () => {
    const a = fakeForm();
    await render(<TestForm form={a} id="a" />);
    const keydown = await enterThenSubmit(field(), {});
    expect(a.submit).toHaveBeenCalledTimes(1);
    expect(keydown.defaultPrevented).toBe(false);
  });

  it.each([
    ['Shift+Enter', { shiftKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Alt+Enter', { altKey: true }],
    ['Cmd+Enter', { metaKey: true }],
    ['Enter while an IME composition is open', { isComposing: true }],
    ['the IME’s own key (229)', { key: 'Process', keyCode: 229 }],
  ])('%s does not save, and the key is not cancelled', async (_, init) => {
    const a = fakeForm();
    await render(<TestForm form={a} id="a" />);
    const keydown = await enterThenSubmit(field(), init);
    expect(a.submit).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
  });

  it('Enter on a radio does not save', async () => {
    const a = fakeForm();
    await render(
      <TestForm form={a} id="a">
        <input aria-label="choice" name="choice" type="radio" />
      </TestForm>,
    );
    await enterThenSubmit(container.querySelector('[aria-label="choice"]') as Element, {});
    expect(a.submit).not.toHaveBeenCalled();
  });

  it('only that keypress is ignored: the next Enter saves', async () => {
    const a = fakeForm();
    await render(<TestForm form={a} id="a" />);
    await enterThenSubmit(field(), { shiftKey: true });
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    await enterThenSubmit(field(), {});
    expect(a.submit).toHaveBeenCalledTimes(1);
  });
});

describe('the save bar with two forms (unchanged)', () => {
  it('Save and Ctrl+S save every dirty form, in order', async () => {
    const order: string[] = [];
    const a = fakeForm({
      submit: vi.fn(async (): Promise<Outcome> => {
        order.push('a');
        return 'saved';
      }),
    });
    const b = fakeForm({
      submit: vi.fn(async (): Promise<Outcome> => {
        order.push('b');
        return 'saved';
      }),
    });
    const clean = fakeForm({ isDirty: false });
    await render(
      <>
        <TestForm form={a} id="a" />
        <TestForm form={clean} id="clean" />
        <TestForm form={b} id="b" />
      </>,
    );
    await act(async () => barSave().click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })));
    expect(order).toEqual(['a', 'b', 'a', 'b']);
    expect(clean.submit).not.toHaveBeenCalled();
  });
});
