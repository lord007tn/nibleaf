import { readerSections } from '@nibleaf/shared/reader-headings';
import { extractHeadings } from '@nibleaf/shared/site';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS, INDENTED_FENCE_AFTER_QUOTE } from '@nibleaf/shared/testing/fence-cases';
import { describe, expect, it } from 'vitest';
import { validateCitedAnswer } from './answer-validation';
import { chunkSearchDocument, type SearchChunkSource } from './hybrid';

const scope = { projectId: 'project', deploymentId: 'deployment', versionSlug: 'v1' };
/** A page as the indexer reads it: the headings the reader renders come with it. */
const page = (content: string, language = 'en'): SearchChunkSource => ({
  id: 'page',
  title: 'Page',
  path: 'page',
  description: '',
  headings: extractHeadings(content).map((heading) => heading.text),
  sections: readerSections(content),
  content,
  language,
  visible: true,
});
const lines = (...parts: string[]) => parts.join('\n');
const sections = (source: SearchChunkSource) =>
  chunkSearchDocument(scope, source).map(({ heading, anchor }) => (anchor === undefined ? [heading] : [heading, anchor]));

describe('section anchors at index time', () => {
  it('gives each chunk the id the reader renders for its section, and none to the text before any heading', () => {
    const content = lines('Intro text.', '', '## Add your domain', '', 'Open settings.', '', '## Wait for the connection', '', 'DNS takes time.');
    expect(sections(page(content))).toEqual([[''], ['Add your domain', 'add-your-domain'], ['Wait for the connection', 'wait-for-the-connection']]);
  });

  it('gives a repeated heading its own id, not the first one’s', () => {
    const content = lines('## Example', '', 'First.', '', '## Other', '', 'Middle.', '', '## Example', '', 'Second.');
    expect(sections(page(content))).toEqual([
      ['Example', 'example'],
      ['Other', 'other'],
      ['Example', 'example-1'],
    ]);
  });

  it('matches headings with inline Markdown, and Arabic headings, to the reader’s ids', () => {
    expect(sections(page(lines('## Install with `npm` and **pnpm**', '', 'Run it.')))).toEqual([
      ['Install with npm and pnpm', 'install-with-npm-and-pnpm'],
    ]);
    expect(sections(page(lines('## انشر', '', 'اختر نشر.', '', '## تحقّق مما يراه القرّاء', '', 'افتح موقعك.'), 'ar'))).toEqual([
      ['انشر', 'انشر'],
      ['تحقّق مما يراه القرّاء', 'تحقّق-مما-يراه-القرّاء'],
    ]);
  });

  it('links an h5 or h6 section to its nearest h1–h4 ancestor, without taking a later heading’s id', () => {
    // The reader's ids run across all six levels: the h5 is `install`, so the h2 is `install-1`.
    const content = lines('## Setup', '', 'Setup text.', '', '##### Install', '', 'Small text.', '', '## Install', '', 'Install text.');
    expect(sections(page(content))).toEqual([
      ['Setup', 'setup'],
      ['Install', 'setup'],
      ['Install', 'install-1'],
    ]);
  });

  it('never cuts a section at a heading inside a fence, even a fence nested in a longer one', () => {
    const content = lines(
      '## Example',
      '',
      '````md',
      '```sh',
      'echo hi',
      '```',
      '## Install',
      '````',
      '',
      '## Install',
      '',
      'Real.',
      '',
      '## Install',
      '',
      'Again.',
    );
    expect(sections(page(content))).toEqual([
      ['Example', 'example'],
      ['Install', 'install'],
      ['Install', 'install-1'],
    ]);
  });

  it('records the id the reader renders for headings with entities, inline HTML and setext form', () => {
    expect(sections(page(lines('## API &amp; keys', '', 'Text.')))).toEqual([['API &amp; keys', 'api--keys']]);
    expect(sections(page(lines('Title', '=====', '', 'Text.', '', 'Sub part', '--------', '', 'More.')))).toEqual([
      ['Title', 'title'],
      ['Sub part', 'sub-part'],
    ]);
    expect(sections(page(lines('## Use <kbd>Ctrl</kbd> keys', '', 'Text.')))).toEqual([['Use Ctrl keys', 'use-ctrl-keys']]);
  });

  it('links an h5 or h6 section, which the table of contents leaves out, to its nearest ancestor', () => {
    const content = lines('## Setup', '', 'Setup text.', '', '##### Fine print', '', 'Small text.', '', '## Next', '', 'Next text.');
    expect(sections(page(content))).toEqual([
      ['Setup', 'setup'],
      ['Fine print', 'setup'],
      ['Next', 'next'],
    ]);
  });

  it('gives every chunk of a long section the same anchor, and leaves content hashes unchanged', () => {
    const long = Array.from({ length: 12 }, (_, index) => `Paragraph ${index} ${'word '.repeat(40)}`).join('\n\n');
    const source = page(lines('## Long section', '', long));
    const chunks = chunkSearchDocument(scope, source, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.anchor))).toEqual(new Set(['long-section']));
    // The anchor never enters the embedding: an index from before anchors keeps its vectors.
    const before = chunkSearchDocument(scope, { ...source, sections: undefined }, { maxChars: 400 });
    expect(before.map((chunk) => chunk.contentHash)).toEqual(chunks.map((chunk) => chunk.contentHash));
    expect(before.every((chunk) => chunk.anchor === undefined)).toBe(true);
  });

  it('finds sections itself without the reader’s, and still skips headings in nested fences', () => {
    const content = lines('## Example', '', '````md', '```sh', '```', '## Not a section', '````', '', '## Next', '', 'Text.');
    expect(sections({ ...page(content), sections: undefined })).toEqual([['Example'], ['Next']]);
  });
});

describe('citations of anchored chunks', () => {
  it('carry the section anchor, and a chunk at the page top carries none', () => {
    const chunks = chunkSearchDocument(scope, page(lines('Intro text.', '', '## Add your domain', '', 'Open settings and add the domain.')));
    const checked = validateCitedAnswer('Add the domain in settings. [S2]\n\nIt starts here. [S1]', chunks, 'domain', 'chat');
    expect(checked.status).toBe('answered');
    const citations = checked.status === 'answered' ? checked.citations : [];
    expect(citations.map(({ id, heading, anchor }) => ({ id, heading, anchor }))).toEqual([
      { id: 'S2', heading: 'Add your domain', anchor: 'add-your-domain' },
      { id: 'S1', heading: undefined, anchor: undefined },
    ]);
  });
});

describe('sections after a fence in a quote or list item (#587)', () => {
  it.each(FENCE_CONTAINER_REPROS)('index the section after %s under its heading and anchor', (_name, example) => {
    const content = `${example}${AFTER_FENCE}\n\nThe after section mentions zebras.`;
    expect(sections(page(content))).toEqual([[''], ['After', 'after']]);
    // Without the reader's sections, the search package finds the heading itself.
    expect(chunkSearchDocument(scope, { ...page(content), sections: undefined }).map(({ heading }) => heading)).toEqual(['', 'After']);
  });

  it('index the section after indented code that looks like a fence, once a quote has ended (#590 council)', () => {
    const content = `${INDENTED_FENCE_AFTER_QUOTE}\n\nThe after section mentions zebras.`;
    expect(sections(page(content))).toEqual([[''], ['After', 'after']]);
    expect(chunkSearchDocument(scope, { ...page(content), sections: undefined }).map(({ heading }) => heading)).toEqual(['', 'After']);
  });
});
