/** @vitest-environment jsdom */

import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusBodyStart, PageTitleField } from './page-title-field';

describe('PageTitleField (B2/B36)', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderField = async (onChange = vi.fn(), onEnter = vi.fn()) => {
    const ref = createRef<HTMLTextAreaElement>();
    await act(async () =>
      root.render(
        <PageTitleField label="Page title" placeholder="Untitled" onChange={onChange} onEnter={onEnter} textareaRef={ref} value="Untitled" />,
      ),
    );
    const field = container.querySelector('textarea');
    if (!field) throw new Error('Title field was not rendered');
    return { field, onChange, onEnter };
  };

  it('moves to the body on Enter instead of inserting a line break', async () => {
    const { field, onEnter } = await renderField();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(event));
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('turns pasted line breaks into spaces', async () => {
    const { field, onChange } = await renderField();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, 'Getting\nstarted');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('Getting started');
  });

  it('wraps long titles (a one-row textarea, not a single-line input)', async () => {
    const { field } = await renderField();
    expect(field.getAttribute('rows')).toBe('1');
    expect(field.wrap).toBe('soft');
    expect(getRole(field)).toBe('textbox');
    expect(computeAccessibleName(field)).toBe('Page title');
    expect(field.placeholder).toBe('Untitled');
    expect(field.dir).toBe('auto');
  });

  it('moves the actual caret to the start of rich text on Enter', async () => {
    const { field } = await renderField(
      undefined,
      vi.fn(() => focusBodyStart(container)),
    );
    const body = document.createElement('div');
    body.className = 'ProseMirror';
    body.contentEditable = 'true';
    body.setAttribute('contenteditable', 'true');
    body.tabIndex = 0;
    body.innerHTML = '<p>Existing body</p>';
    container.append(body);
    field.focus();
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(body);
    expect(window.getSelection()?.anchorNode).toBe(body);
    expect(window.getSelection()?.anchorOffset).toBe(0);
  });

  it('moves to source offset zero and ignores Enter during IME composition', async () => {
    const { field, onEnter } = await renderField();
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(onEnter).not.toHaveBeenCalled();
    const source = document.createElement('textarea');
    source.value = 'Existing source';
    container.append(source);
    focusBodyStart(container);
    expect(document.activeElement).toBe(source);
    expect(source.selectionStart).toBe(0);
    expect(source.selectionEnd).toBe(0);
  });
});
