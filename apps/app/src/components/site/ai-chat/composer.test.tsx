// @vitest-environment jsdom

import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './composer';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
});

/** The composer with its text in state, as the panel holds it. */
function Harness({
  initial,
  ...props
}: {
  initial: string;
  busy: boolean;
  lang: string;
  send: (q: string) => boolean | Promise<boolean>;
  stop: () => void;
}) {
  const [value, setValue] = useState(initial);
  return <Composer {...props} value={value} setValue={setValue} field={createRef<HTMLTextAreaElement>()} />;
}
const mount = async (props: { busy?: boolean; value?: string; lang?: string; send?: (q: string) => boolean | Promise<boolean> }) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(() => act(async () => root.unmount()));
  const send = vi.fn(props.send ?? (() => true));
  const stop = vi.fn();
  const render = (busy: boolean) =>
    act(async () => root.render(<Harness initial={props.value ?? ''} busy={busy} lang={props.lang ?? 'en'} send={send} stop={stop} />));
  await render(props.busy ?? false);
  const field = () => container.querySelector('textarea') as HTMLTextAreaElement;
  /** The form's one button, by its accessible name. */
  const action = () => container.querySelector('form button') as HTMLButtonElement;
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), text);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const press = (init: KeyboardEventInit & { isComposing?: boolean }) =>
    act(async () => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      field().dispatchEvent(event);
      // A key the composer leaves alone types as usual (a newline for Shift+Enter).
      if (!event.defaultPrevented && init.key === 'Enter') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), `${field().value}\n`);
        field().dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  return { send, stop, field, action, type, press, render, form: container.querySelector('form') as HTMLFormElement };
};

describe('composer', () => {
  it('sends with its inline Send button, named for screen readers, right after the field', async () => {
    const { send, field, action, form } = await mount({ value: 'How do I export?' });
    expect(action().textContent).toBe('Send');
    expect(action().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // The field and the button share one row: the button follows the field directly.
    expect(form.lastElementChild).toBe(action());
    expect(form.firstElementChild?.contains(field())).toBe(true);
    await act(async () => action().click());
    expect(send).toHaveBeenCalledExactlyOnceWith('How do I export?');
    expect(field().value).toBe('');
  });

  it('keeps Send disabled until there is a question to send', async () => {
    const { action, type } = await mount({ value: ' a ' });
    expect(action().disabled).toBe(true);
    await type('How?');
    expect(action().disabled).toBe(false);
  });

  it('sends on Enter and adds a line on Shift+Enter', async () => {
    const { send, field, press } = await mount({ value: 'First line' });
    await press({ key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    expect(field().value).toBe('First line\n');
    await press({ key: 'Enter' });
    expect(send).toHaveBeenCalledExactlyOnceWith('First line');
  });

  it('never sends on the Enter that confirms an input method composition', async () => {
    const { send, field, press } = await mount({ value: 'كيف' });
    await press({ key: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    expect(field().value.startsWith('كيف')).toBe(true);
  });

  it('gives the question back when it could not be sent', async () => {
    const { send, field, action } = await mount({ value: 'How do I export?', send: async () => false });
    await act(async () => action().click());
    expect(send).toHaveBeenCalledOnce();
    expect(field().value).toBe('How do I export?');
  });

  it('gives the question back when sending throws, but keeps a new draft typed meanwhile', async () => {
    let fail: (reason: Error) => void = () => undefined;
    const { field, action, type } = await mount({
      value: 'How do I export?',
      send: () =>
        new Promise<boolean>((_, reject) => {
          fail = reject;
        }),
    });
    await act(async () => action().click());
    expect(field().value).toBe('');
    await type('Another question');
    await act(async () => fail(new Error('offline')));
    expect(field().value).toBe('Another question');
  });

  it('holds Stop, busy, in the same slot while answering, and sends nothing then', async () => {
    const { send, stop, action, press, render, form } = await mount({ value: 'Next question' });
    const slot = action();
    expect(form.lastElementChild).toBe(slot);
    await render(true);
    expect(form.querySelectorAll('button')).toHaveLength(1);
    expect(form.lastElementChild).toBe(action());
    expect(action().textContent).toBe('Stop generating');
    expect(action().getAttribute('aria-busy')).toBe('true');
    // Stop is the way out of the wait, so it stays usable.
    expect(action().disabled).toBe(false);
    await press({ key: 'Enter' });
    expect(send).not.toHaveBeenCalled();
    await act(async () => action().click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it('uses the Arabic labels in an Arabic chat', async () => {
    const { action, field } = await mount({ lang: 'ar', value: 'كيف أبدأ؟' });
    expect(action().textContent).toBe('إرسال');
    expect(field().getAttribute('aria-label')).toBeTruthy();
  });
});
