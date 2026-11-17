import { extractHeadings } from '@nibleaf/shared';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { expect, it } from 'vitest';
import { normalizeMdxBlocks } from './mdx-config';

it('published reader keeps headings, sections and embeds after valid quote and list fences', () => {
  const examples = [
    '> ```md\n> example\n>```',
    '> ```md\n> example\n> ```',
    '> > ```md\n> > example\n>>```',
    '> ```md\n>\texample\n>```',
    '>\t```md\n>\texample\n>\t```',
    '- ```md\n  example\n  ```',
    '- ```md\n\texample\n  ```',
  ];
  const results = examples.map((example) => {
    const source = `${example}\n\n# After\n\n<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>`;
    return {
      headings: extractHeadings(source).map(({ text }) => text),
      sections: readerSections(source).map(({ text }) => text),
      embed: normalizeMdxBlocks(source).includes('<mdxembed'),
    };
  });
  expect(results).toEqual(examples.map(() => ({ headings: ['After'], sections: ['After'], embed: true })));
});
