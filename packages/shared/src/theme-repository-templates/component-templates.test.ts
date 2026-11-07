import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { markdownTemplate, markdownTestTemplate } from './markdown';
import {
  mdxApiExampleTemplate,
  mdxCalloutsTemplate,
  mdxCardsTemplate,
  mdxDisclosureTemplate,
  mdxFieldsTemplate,
  mdxFileTreeTemplate,
  mdxIndexTemplate,
  mdxInlineTemplate,
  mdxSharedTemplate,
  mdxStepsTemplate,
  mdxTabsTemplate,
  mdxTooltipTemplate,
} from './mdx-components';

/** The first 12 hex characters of a file's SHA-256: enough to catch any drift,
 *  and short enough not to read like a secret to secret scanners. */
const sha256Prefix = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);

describe('theme repository component templates', () => {
  // Exported repositories must not churn when the component registry is refactored.
  // A deliberate template change updates these prefixes in the same commit.
  // Changes so far:
  // - src/lib/markdown.tsx and src/components/mdx/fields.tsx: ParamField and
  //   ResponseField names were stripped in exported repositories, because
  //   `rehypeAuthoredComponentProps` moves `name` to `dataDisplayName` but the
  //   allow-list only had `name` and `Field` only read `name`. The allow-list now
  //   has `dataDisplayName` and `Field` reads it through `authoredName`.
  // - src/lib/markdown.tsx: `u` joins the allowed tags, like the reader, so the
  //   editor's underlines render in exported repositories.
  // - src/components/mdx/cards.tsx: `CardGroup` read `cols` as a string, but
  //   HTML parses it as a number, so every group had two columns. It now
  //   accepts one to four and sets the column count the stylesheet reads.
  // - src/components/mdx/shared.ts: `truthy` also reads the JSX `{true}` that
  //   Mintlify pages use, so `defaultOpen={true}` opens and `required={true}` shows.
  it('keeps the exported Markdown and MDX component files byte-identical', () => {
    const sha256Prefixes = {
      'src/lib/markdown.tsx': sha256Prefix(markdownTemplate()),
      'src/lib/markdown.test.tsx': sha256Prefix(markdownTestTemplate()),
      'src/components/mdx/shared.ts': sha256Prefix(mdxSharedTemplate()),
      'src/components/mdx/callouts.tsx': sha256Prefix(mdxCalloutsTemplate()),
      'src/components/mdx/cards.tsx': sha256Prefix(mdxCardsTemplate()),
      'src/components/mdx/tabs.tsx': sha256Prefix(mdxTabsTemplate()),
      'src/components/mdx/disclosure.tsx': sha256Prefix(mdxDisclosureTemplate()),
      'src/components/mdx/steps.tsx': sha256Prefix(mdxStepsTemplate()),
      'src/components/mdx/fields.tsx': sha256Prefix(mdxFieldsTemplate()),
      'src/components/mdx/file-tree.tsx': sha256Prefix(mdxFileTreeTemplate()),
      'src/components/mdx/api-example.tsx': sha256Prefix(mdxApiExampleTemplate()),
      'src/components/mdx/tooltip.tsx': sha256Prefix(mdxTooltipTemplate()),
      'src/components/mdx/inline.tsx': sha256Prefix(mdxInlineTemplate()),
      'src/components/mdx/index.tsx': sha256Prefix(mdxIndexTemplate()),
    };
    expect(sha256Prefixes).toEqual({
      'src/lib/markdown.tsx': '06c83728de3f',
      'src/lib/markdown.test.tsx': '83c141811932',
      'src/components/mdx/shared.ts': '294a4e03b36a',
      'src/components/mdx/callouts.tsx': 'f468dfa7c363',
      'src/components/mdx/cards.tsx': 'f8064f401309',
      'src/components/mdx/tabs.tsx': '613800c9ea94',
      'src/components/mdx/disclosure.tsx': '289e2634932f',
      'src/components/mdx/steps.tsx': 'd43dcdc5f286',
      'src/components/mdx/fields.tsx': '9d83a6bee236',
      'src/components/mdx/file-tree.tsx': '2e128d0a6f84',
      'src/components/mdx/api-example.tsx': 'da8189c1d4fd',
      'src/components/mdx/tooltip.tsx': 'ec6a45a817f7',
      'src/components/mdx/inline.tsx': 'd18ff1825f92',
      'src/components/mdx/index.tsx': '5c494b23b6ae',
    });
  });
});
