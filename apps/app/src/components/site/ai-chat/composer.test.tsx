// @vitest-environment jsdom

import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './composer';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
});
const mount = async (props: { busy: boolean; value?: string; lang?: string }) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(() => act(async () => root.unmount()));
  const send = vi.fn();
  const stop = vi.fn();
  await act(async () =>
    root.render(
      <Composer
        lang={props.lang ?? 'en'}
        busy={props.busy}
        value={props.value ?? ''}
        setValue={vi.fn()}
        field={createRef<HTMLTextAreaElement>()}
        send={send}
        stop={stop}
      />,
    ),
  );
  return { send, stop, form: container.querySelector('form') as HTMLFormElement };
};

describe('composer', () => {
  it('puts the send icon button inline at the end of the field, named for screen readers', async () => {
    const { form, send } = await mount({ busy: false, value: 'How do I export?' });
    // One row: the field, then the button beside it.
    expect(form.className).toContain('flex');
    expect(form.className).not.toContain('space-y');
    const [field, button] = [...form.children];
    expect(field?.querySelector('textarea')).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('submit');
    expect(button?.textContent).toBe('Send');
    expect(button?.querySelector('.sr-only')?.textContent).toBe('Send');
    // The arrow follows the reading direction.
    expect(button?.querySelector('svg')?.getAttribute('class')).toContain('rtl:-scale-x-100');
    await act(async () => (button as HTMLButtonElement).click());
    expect(send).toHaveBeenCalledWith('How do I export?');
  });

  it('keeps send disabled until there is a question to send', async () => {
    const { form } = await mount({ busy: false, value: ' a ' });
    expect(form.querySelector('button')?.disabled).toBe(true);
  });

  it('shows a busy Stop button with a spinner in the same fixed-size slot while answering', async () => {
    const idle = await mount({ busy: false, value: 'Hi there' });
    const sendClass = idle.form.querySelector('button')?.className ?? '';
    document.body.replaceChildren();
    const { form, stop, send } = await mount({ busy: true, value: 'Next question' });
    const buttons = form.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe('Stop generating');
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    // Same size as Send, so nothing moves when an answer starts or ends.
    for (const size of ['size-(--control-size-large)', 'shrink-0', 'rounded-full']) {
      expect(button.className).toContain(size);
      expect(sendClass).toContain(size);
    }
    // Enter does not send a second question while one is being answered.
    await act(async () => form.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(send).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it('uses the Arabic labels in an Arabic chat', async () => {
    const { form } = await mount({ busy: false, lang: 'ar', value: 'كيف أبدأ؟' });
    expect(form.querySelector('button')?.textContent).toBe('إرسال');
    expect(form.querySelector('textarea')?.getAttribute('aria-label')).toBeTruthy();
  });
});
