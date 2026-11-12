import { readFileSync } from 'node:fs';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { describe, expect, it } from 'vitest';
import { normalizeMintlifyMdx } from './mintlify-mdx';

describe('normalizeMintlifyMdx', () => {
  it('imports iframes and videos as authored HTML, which the reader then renders as players, links and videos', () => {
    const fixture = (name: string) => readFileSync(new URL(`../../../../../packages/shared/src/__fixtures__/${name}`, import.meta.url), 'utf8');
    const imported = normalizeMintlifyMdx(fixture('mintlify-video-embeds.mdx'));
    // The imported page is pinned: the reader's tests render this exact file.
    expect(imported).toBe(fixture('mintlify-video-embeds.imported.mdx'));
    expect(imported).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc123"');
    expect(imported).toContain('<iframe src="https://www.loom.com/embed/0123456789abcdef0123456789abcdef" title="Loom walkthrough"');
    expect(imported).toContain('<video controls className="w-full aspect-video rounded-xl" src="https://cdn.example.com/b.mp4"></video>');
    const reader = normalizeMdxBlocks(imported);
    expect(reader).toContain('<mdxembed provider="youtube" videoid="dQw4w9WgXcQ" title="YouTube video player"></mdxembed>');
    expect(reader).toContain('<mdxembed provider="loom" videoid="0123456789abcdef0123456789abcdef" title="Loom walkthrough"></mdxembed>');
    expect(reader).toContain('<mdxembed href="https://codepen.io/team/embed/abc" title="A pen"></mdxembed>');
    expect(reader).toContain(
      '<video autoPlay muted loop playsInline className="w-full aspect-video rounded-xl" src="https://cdn.example.com/demo.mp4" ></video>',
    );
    expect(reader).not.toContain('<iframe');
  });

  it('keeps an unclosed fence literal through the end of the document', () => {
    const source = ['```mdx', '<Step title="Literal">', '~~~', '</Step>'].join('\n');
    expect(normalizeMintlifyMdx(source)).toBe(source);
  });

  it('resumes component conversion only after the matching closing fence', () => {
    const source = ['````mdx', '<Steps>', '```', '</Steps>', '````', '<Step title="Real">', '  Ready', '</Step>'].join('\n');
    expect(normalizeMintlifyMdx(source)).toBe(['````mdx', '<Steps>', '```', '</Steps>', '````', '### Real', 'Ready'].join('\n'));
  });

  it('preserves component and image source inside a fenced code example', () => {
    const source = ['```mdx', '<Steps>', '<Step title="Example">', '<img src="/example.png" />', '</Step>', '</Steps>', '```'].join('\n');
    expect(normalizeMintlifyMdx(source)).toBe(source);
  });

  it('preserves code examples nested in a real component without changing their indentation', () => {
    const source = [
      '<Step title="Example">',
      '  ~~~~mdx',
      '  <Step title="Literal">',
      '    <img src="/example.png" />',
      '  </Step>',
      '  ~~~',
      '  ~~~~',
      '</Step>',
    ].join('\n');
    expect(normalizeMintlifyMdx(source)).toBe(
      ['### Example', '~~~~mdx', '<Step title="Literal">', '  <img src="/example.png" />', '</Step>', '~~~', '~~~~'].join('\n'),
    );
  });

  it('dedents Markdown nested in Mintlify components without flattening real list indentation', () => {
    const source = [
      '<Steps>',
      '  <Step title="Watch">',
      '    Intro',
      '',
      '    - first',
      '      - nested',
      '',
      '    ```bash',
      '    echo ready',
      '    ```',
      '  </Step>',
      '</Steps>',
    ].join('\n');

    expect(normalizeMintlifyMdx(source)).toBe(['### Watch', 'Intro', '', '- first', '  - nested', '', '```bash', 'echo ready', '```'].join('\n'));
  });

  it('converts migrated MDX images to first-class Markdown images', () => {
    const source = [
      '<Expandable title="Example">',
      '  <img className="rounded-xl" alt="Result" src="/api/public/assets/result.png" />',
      '</Expandable>',
    ].join('\n');

    expect(normalizeMintlifyMdx(source)).toBe(['#### Example', '![Result](/api/public/assets/result.png)'].join('\n'));
  });

  it('removes CodeGroup layout and Mintlify-only fence labels', () => {
    const source = ['<CodeGroup>', '  ```bash Docker (docker run)', '  docker run app', '  ```', '</CodeGroup>'].join('\n');
    expect(normalizeMintlifyMdx(source)).toBe(['```bash', 'docker run app', '```'].join('\n'));
  });
});
