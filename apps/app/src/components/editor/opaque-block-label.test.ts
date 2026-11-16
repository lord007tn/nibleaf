// @vitest-environment jsdom
/**
 * #668: an unsupported block's label ("LEGACYNOTICE · UNSUPPORTED BLOCK ·
 * SOURCE PRESERVED") wrapped at 390 px and its second line ran over the first
 * line of the block's source. It was placed out of the flow, over a top padding
 * with room for one line. It is now in the flow above the source, so a label
 * of any length pushes the source down instead of overlapping it.
 *
 * jsdom has no layout, so this reads the editor's own stylesheet as the browser
 * would (its CSSOM) and checks what decides overlap: the label's box.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let style: HTMLStyleElement;

beforeAll(() => {
  style = document.createElement('style');
  style.textContent = readFileSync(resolve('src/components/editor/tiptap.css'), 'utf8');
  document.head.append(style);
});

afterAll(() => style.remove());

const rule = (selector: string): CSSStyleDeclaration => {
  const sheet = style.sheet;
  if (!sheet) throw new Error('No stylesheet');
  const found = [...sheet.cssRules].find((item): item is CSSStyleRule => item instanceof CSSStyleRule && item.selectorText === selector);
  if (!found) throw new Error(`No rule for ${selector}`);
  return found.style;
};

describe('#668: an unsupported block’s label never overlaps its source', () => {
  it('the label is in the flow above the source, so when it wraps the source moves down with it', () => {
    const label = rule('.pl-editor .pl-mdx-opaque-block::before');
    expect(label.getPropertyValue('content')).toContain('unsupported block');
    // Not taken out of the flow (it was absolute, over a padding one line tall).
    expect(label.getPropertyValue('position')).not.toBe('absolute');
    expect(label.getPropertyValue('position')).not.toBe('fixed');
    expect(label.getPropertyValue('float')).toBe('');
    expect(label.getPropertyValue('display')).toBe('block');
    // It wraps between words (the block keeps the source's own line breaks; its label doesn't), with room under its last line.
    expect(label.getPropertyValue('white-space')).toBe('normal');
    expect(label.getPropertyValue('margin-block-end')).not.toBe('');
  });

  it('the block no longer reserves a fixed one-line band at its top for the label', () => {
    const block = rule('.pl-editor .pl-mdx-opaque-block');
    const top = block.getPropertyValue('padding-top') || block.getPropertyValue('padding').split(/\s+/)[0];
    // The label's own line now spaces the source; the top padding is the same inset as the label had (0.65rem).
    expect(top).toBe('0.65rem');
  });

  it('a long label, in the editor, sits in the block before its source text', () => {
    const host = document.createElement('div');
    host.className = 'pl-editor';
    host.innerHTML =
      '<div class="ProseMirror"><div class="pl-mdx-opaque-block" data-mdx-opaque="block" data-name="LegacyNoticeWithAVeryLongName" contenteditable="false">&lt;LegacyNotice&gt;KEEP&lt;/LegacyNotice&gt;</div></div>';
    document.body.append(host);
    try {
      const block = host.querySelector('.pl-mdx-opaque-block');
      if (!block) throw new Error('No block');
      const label = getComputedStyle(block, '::before');
      // jsdom computes pseudo-elements from the cascade: the label's box, as the browser lays it out.
      expect(label.getPropertyValue('position')).not.toBe('absolute');
      expect(label.getPropertyValue('display')).toBe('block');
      expect(getComputedStyle(block).getPropertyValue('white-space')).toBe('pre-wrap');
    } finally {
      host.remove();
    }
  });
});
