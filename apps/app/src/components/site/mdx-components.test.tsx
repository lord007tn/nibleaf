// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Accordion, CodeGroup, Expandable, Tab, Tabs } from './mdx-components';

describe('interactive MDX components', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('supports roving keyboard focus for LTR tabs', async () => {
    await act(async () =>
      root.render(
        <Tabs language="en">
          <Tab title="One">First</Tab>
          <Tab title="Two">Second</Tab>
        </Tabs>,
      ),
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0]?.focus();
    act(() => tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
  });

  it('reverses horizontal arrow behavior for an RTL code group', async () => {
    await act(async () =>
      root.render(
        <div dir="rtl">
          <CodeGroup language="ar">
            <pre data-title="one.js">
              <code className="language-js">one</code>
            </pre>
            <pre data-title="two.js">
              <code className="language-js">two</code>
            </pre>
          </CodeGroup>
        </div>,
      ),
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0]?.focus();
    act(() => tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
  });

  it('keeps accordion and expandable controls linked to persistent panels', async () => {
    await act(async () =>
      root.render(
        <>
          <Accordion title="Details">Accordion body</Accordion>
          <Expandable title="Properties">Expandable body</Expandable>
        </>,
      ),
    );
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls]')];
    for (const button of buttons) {
      const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
      expect(panel).not.toBeNull();
      expect(panel?.hidden).toBe(true);
      act(() => button.click());
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(panel?.hidden).toBe(false);
    }
  });
});
