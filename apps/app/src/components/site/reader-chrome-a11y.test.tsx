/** @vitest-environment jsdom */
/**
 * Reader chrome semantics from the phase 1 audit: the language menu announces
 * the current language (PUB-014), task checkboxes are named (P3-PUB-025), and
 * the layout adds no anonymous landmarks around its navigation (P3-PUB-026).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '@/components/markdown';
import RichMarkdown from '@/components/markdown-rich';
import { LanguageMenu } from '@/components/site/header-menus';
import { DOCUMENTATION_THEME_TEMPLATES } from './documentation-theme-provider';

const languages = [
  { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true },
  { code: 'ar', label: 'العربية', direction: 'RTL' as const, isDefault: false },
];

describe('language menu', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is a radio menu: the current language is checked, and picking one reports it', async () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<LanguageMenu languages={languages} activeCode="ar" onChange={onChange} start={{ defaultOpen: true, focusTrigger: false }} />),
    );
    const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['English', 'false'],
      ['العربية', 'true'],
    ]);
    await act(async () => (items[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith('en');
    act(() => root.unmount());
  });
});

describe('task lists', () => {
  it('names each read-only checkbox after its item, without its sub-items', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <MarkdownRenderer content={['- [x] Sandbox **shipment** booked', '- [ ] Live key rotated', '  - [ ] Vault updated'].join('\n')} />,
    );
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(['Sandbox shipment booked', 'Live key rotated', 'Vault updated']);
  });

  it('names checkboxes in a loose list too, where each sits inside a paragraph', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<MarkdownRenderer content={['- [ ] Alpha', '', '- [x] Beta', '', '  - [ ] Gamma'].join('\n')} />);
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    expect(boxes[0]?.closest('p')).not.toBeNull();
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('names an image-only task after the image', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<MarkdownRenderer content="- [ ] ![Shipment booked](/shipment.png)" />);
    expect(host.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBe('Shipment booked');
  });

  it('keeps the name an authored checkbox already has (raw HTML, the rich renderer)', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <RichMarkdown content={'<ul><li class="task-list-item">Parent<div><input type="checkbox" title="Approval recorded"></div></li></ul>'} />,
    );
    const box = host.querySelector('input[type="checkbox"]');
    expect(box?.getAttribute('title')).toBe('Approval recorded');
    expect(box?.hasAttribute('aria-label')).toBe(false);
  });

  it('leaves a checkbox in a plain item inside a task item unnamed, never borrowing the task name', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<MarkdownRenderer content={['- [ ] Parent task', '  - plain note'].join('\n')} />);
    expect(Array.from(host.querySelectorAll('input')).map((box) => box.getAttribute('aria-label'))).toEqual(['Parent task']);
  });
});

it('keeps the sidebar and outline navigation free of redundant landmarks in every reader theme', () => {
  const sidebar = <nav aria-label="Documentation pages" />;
  const outline = <nav aria-label="On this page" />;
  const host = document.createElement('div');

  for (const template of Object.values(DOCUMENTATION_THEME_TEMPLATES)) {
    host.innerHTML = renderToStaticMarkup(
      template.ReaderLayout({
        header: null,
        navigation: sidebar,
        content: template.PageLayout({ article: <article>Guide</article>, tableOfContents: outline }),
      }),
    );
    const labels = Array.from(host.querySelectorAll('nav'), (nav) => nav.getAttribute('aria-label'));
    expect(labels, template.id).toEqual(['Documentation pages', 'On this page']);
    expect(host.querySelector('aside, [role="complementary"]'), template.id).toBeNull();
  }
});
