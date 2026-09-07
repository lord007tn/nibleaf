import { describe, expect, it } from 'vitest';
import { normalizeMintlifyMdx } from './mintlify-mdx';

describe('normalizeMintlifyMdx', () => {
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
