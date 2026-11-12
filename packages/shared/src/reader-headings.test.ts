import { describe, expect, it } from 'vitest';
import { readerHeadings, readerSections } from './reader-headings';

const lines = (...parts: string[]) => parts.join('\n');
const ids = (content: string) => readerHeadings(content).map(({ depth, text, id }) => [depth, text, id]);
const at = (content: string) => readerSections(content).map(({ line, depth, id }) => [line, depth, id]);

describe('the reader’s headings', () => {
  it('gives repeated headings -1, -2 across all six levels, as the renderer does', () => {
    expect(ids(lines('## Setup', '', '##### Install', '', '## Install', '', '###### Install'))).toEqual([
      [2, 'Setup', 'setup'],
      [5, 'Install', 'install'],
      [2, 'Install', 'install-1'],
      [6, 'Install', 'install-2'],
    ]);
  });

  it('reads headings as the page shows them: entities decoded, inline Markdown and HTML tags dropped', () => {
    expect(ids('## API &amp; keys')).toEqual([[2, 'API & keys', 'api--keys']]);
    expect(ids('## Install with `npm` and **pnpm**')).toEqual([[2, 'Install with npm and pnpm', 'install-with-npm-and-pnpm']]);
    expect(ids('## Use <kbd>Ctrl</kbd> keys')).toEqual([[2, 'Use Ctrl keys', 'use-ctrl-keys']]);
  });

  it('finds headings inside components, and none inside fences of any length', () => {
    expect(ids(lines('<Note>', '## Inside a note', '</Note>'))).toEqual([[2, 'Inside a note', 'inside-a-note']]);
    expect(ids(lines('````md', '```', '## Not a heading', '```', '````', '', '## Real'))).toEqual([[2, 'Real', 'real']]);
  });

  it('keeps an id the author set (prefixed by the sanitizer) without counting it', () => {
    expect(ids(lines('<h2 id="custom">Custom</h2>', '', '## Custom'))).toEqual([
      [2, 'Custom', 'user-content-custom'],
      [2, 'Custom', 'custom'],
    ]);
  });

  it('reads setext headings and Arabic headings', () => {
    expect(ids(lines('Title', '=====', '', 'Sub', '---'))).toEqual([
      [1, 'Title', 'title'],
      [2, 'Sub', 'sub'],
    ]);
    expect(ids(lines('## التثبيت', '', '## التثبيت'))).toEqual([
      [2, 'التثبيت', 'التثبيت'],
      [2, 'التثبيت', 'التثبيت-1'],
    ]);
  });
});

describe('the reader’s headings at their source lines', () => {
  it('pairs each written heading with its rendered id, skipping lines the reader does not render as headings', () => {
    const content = lines('## Example', '', '````md', '```sh', '```', '## Install', '````', '', '## Install', '', '## Install');
    expect(at(content)).toEqual([
      [0, 2, 'example'],
      [8, 2, 'install'],
      [10, 2, 'install-1'],
    ]);
  });

  it('keeps h5 and h6 lines in order without shifting later ids', () => {
    expect(at(lines('## Setup', '', '##### Install', '', '## Install'))).toEqual([
      [0, 2, 'setup'],
      [2, 5, 'install'],
      [4, 2, 'install-1'],
    ]);
  });

  it('pairs a heading with math by its place, and a raw HTML heading has no line', () => {
    expect(at(lines('## Area of $a^2$', '', '<h2>Raw</h2>', '', '## Next'))).toEqual([
      [0, 2, readerHeadings('## Area of $a^2$')[0]?.id],
      [4, 2, 'next'],
    ]);
  });

  it('pairs setext headings at their text line, and headings in components', () => {
    expect(at(lines('Title', '=====', '', '<Note>', '## Inside', '</Note>'))).toEqual([
      [0, 1, 'title'],
      [4, 2, 'inside'],
    ]);
  });
});
