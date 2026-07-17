import { describe, expect, it } from 'vitest';
import { normalizeMintlifyMdx } from './mintlify-mdx';

describe('normalizeMintlifyMdx', () => {
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
