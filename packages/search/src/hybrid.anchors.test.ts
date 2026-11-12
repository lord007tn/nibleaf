import { extractHeadings } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { validateCitedAnswer } from './answer-validation';
import { chunkSearchDocument, type SearchChunkSource } from './hybrid';

const scope = { projectId: 'project', deploymentId: 'deployment', versionSlug: 'v1' };
/** A page as the indexer reads it: the reader's own heading ids come with it. */
const page = (content: string, language = 'en'): SearchChunkSource => {
  const headings = extractHeadings(content);
  return {
    id: 'page',
    title: 'Page',
    path: 'page',
    description: '',
    headings: headings.map((heading) => heading.text),
    anchors: headings.map(({ text, id }) => ({ text, id })),
    content,
    language,
    visible: true,
  };
};
const sections = (source: SearchChunkSource) =>
  chunkSearchDocument(scope, source).map(({ heading, anchor }) => (anchor === undefined ? [heading] : [heading, anchor]));

describe('section anchors at index time', () => {
  it('gives each chunk the id the reader renders for its section, and none to the text before any heading', () => {
    const content = 'Intro text.\n\n## Add your domain\n\nOpen settings.\n\n## Wait for the connection\n\nDNS takes time.';
    expect(sections(page(content))).toEqual([[''], ['Add your domain', 'add-your-domain'], ['Wait for the connection', 'wait-for-the-connection']]);
  });

  it('gives a repeated heading its own id, not the first one’s', () => {
    const content = '## Example\n\nFirst.\n\n## Other\n\nMiddle.\n\n## Example\n\nSecond.';
    expect(sections(page(content))).toEqual([
      ['Example', 'example'],
      ['Other', 'other'],
      ['Example', 'example-1'],
    ]);
  });

  it('matches headings with inline Markdown, and Arabic headings, to the reader’s ids', () => {
    expect(sections(page('## Install with `npm` and **pnpm**\n\nRun it.'))).toEqual([['Install with npm and pnpm', 'install-with-npm-and-pnpm']]);
    expect(sections(page('## انشر\n\nاختر نشر.\n\n## تحقّق مما يراه القرّاء\n\nافتح موقعك.', 'ar'))).toEqual([
      ['انشر', 'انشر'],
      ['تحقّق مما يراه القرّاء', 'تحقّق-مما-يراه-القرّاء'],
    ]);
  });

  it('links an h5 or h6 section, which the reader gives no id, to its nearest ancestor', () => {
    const content = '## Setup\n\nSetup text.\n\n##### Fine print\n\nSmall text.\n\n## Next\n\nNext text.';
    expect(sections(page(content))).toEqual([
      ['Setup', 'setup'],
      ['Fine print', 'setup'],
      ['Next', 'next'],
    ]);
  });

  it('does not let a heading inside fenced code shift the ids', () => {
    const content = '## Run\n\n```sh\n## not a heading\necho hi\n```\n\n## Run\n\nAgain.';
    expect(sections(page(content))).toEqual([
      ['Run', 'run'],
      ['Run', 'run-1'],
    ]);
  });

  it('gives every chunk of a long section the same anchor, and leaves content hashes unchanged', () => {
    const long = Array.from({ length: 12 }, (_, index) => `Paragraph ${index} ${'word '.repeat(40)}`).join('\n\n');
    const source = page(`## Long section\n\n${long}`);
    const chunks = chunkSearchDocument(scope, source, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.anchor))).toEqual(new Set(['long-section']));
    // The anchor never enters the embedding: an index from before anchors keeps its vectors.
    const before = chunkSearchDocument(scope, { ...source, anchors: undefined }, { maxChars: 400 });
    expect(before.map((chunk) => chunk.contentHash)).toEqual(chunks.map((chunk) => chunk.contentHash));
    expect(before.every((chunk) => chunk.anchor === undefined)).toBe(true);
  });
});

describe('citations of anchored chunks', () => {
  it('carry the section anchor, and a chunk at the page top carries none', () => {
    const chunks = chunkSearchDocument(scope, page('Intro text.\n\n## Add your domain\n\nOpen settings and add the domain.'));
    const checked = validateCitedAnswer('Add the domain in settings. [S2]\n\nIt starts here. [S1]', chunks, 'domain', 'chat');
    expect(checked.status).toBe('answered');
    const citations = checked.status === 'answered' ? checked.citations : [];
    expect(citations.map(({ id, heading, anchor }) => ({ id, heading, anchor }))).toEqual([
      { id: 'S2', heading: 'Add your domain', anchor: 'add-your-domain' },
      { id: 'S1', heading: undefined, anchor: undefined },
    ]);
  });
});
