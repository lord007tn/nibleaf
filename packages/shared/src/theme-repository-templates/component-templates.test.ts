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

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('theme repository component templates', () => {
  // Exported repositories must not churn when the component registry is refactored.
  // A deliberate template change updates these hashes in the same commit.
  it('keeps the exported Markdown and MDX component files byte-identical', () => {
    expect({
      'src/lib/markdown.tsx': sha256(markdownTemplate()),
      'src/lib/markdown.test.tsx': sha256(markdownTestTemplate()),
      'src/components/mdx/shared.ts': sha256(mdxSharedTemplate()),
      'src/components/mdx/callouts.tsx': sha256(mdxCalloutsTemplate()),
      'src/components/mdx/cards.tsx': sha256(mdxCardsTemplate()),
      'src/components/mdx/tabs.tsx': sha256(mdxTabsTemplate()),
      'src/components/mdx/disclosure.tsx': sha256(mdxDisclosureTemplate()),
      'src/components/mdx/steps.tsx': sha256(mdxStepsTemplate()),
      'src/components/mdx/fields.tsx': sha256(mdxFieldsTemplate()),
      'src/components/mdx/file-tree.tsx': sha256(mdxFileTreeTemplate()),
      'src/components/mdx/api-example.tsx': sha256(mdxApiExampleTemplate()),
      'src/components/mdx/tooltip.tsx': sha256(mdxTooltipTemplate()),
      'src/components/mdx/inline.tsx': sha256(mdxInlineTemplate()),
      'src/components/mdx/index.tsx': sha256(mdxIndexTemplate()),
    }).toMatchInlineSnapshot(`
      {
        "src/components/mdx/api-example.tsx": "da8189c1d4fd539ad11cfde084bcd80c3d10d579454d0074e444416ac3a355d2",
        "src/components/mdx/callouts.tsx": "f468dfa7c363080b29adb3174a580f02c833cc41a304cd7765db34c171291f95",
        "src/components/mdx/cards.tsx": "90012875f3fe5d0c247f16ec630b178cb9ce37e317be1ce1163ff2b2605ce296",
        "src/components/mdx/disclosure.tsx": "289e2634932f4e5ba97c936cc7121741fc697d3c09cc7aadbd7b9edffa474f98",
        "src/components/mdx/fields.tsx": "d37dae3d6c385e19dd5ce8e85eaebaa9ecb835ad2ac0193f36c9e9802159189d",
        "src/components/mdx/file-tree.tsx": "2e128d0a6f8494954c21f0227700f20f28a228826c7f99d907d28e613c2ab537",
        "src/components/mdx/index.tsx": "5c494b23b6ae58c0d611bbdc43b5e0800ce6f4153b5e2b6676c4d7d64882a668",
        "src/components/mdx/inline.tsx": "d18ff1825f9283505b6f3cb549d0eeec69c683dd2267d6ebd4b2e590a03b508c",
        "src/components/mdx/shared.ts": "b00369d3fd119af03179f66ee325e9f52c707ca3572339b3bb7cab49d16fac28",
        "src/components/mdx/steps.tsx": "d43dcdc5f28618e07804107517c6fcbf4d7eb91701f548be28bcd421819e3c2b",
        "src/components/mdx/tabs.tsx": "613800c9ea9445ae6017c18b40c1cdc05664b2b35442690d6d6b1a046f97a1ca",
        "src/components/mdx/tooltip.tsx": "ec6a45a817f712c8d106edc3ea61fcc6f5b8c629fdff38afbe93bc401f8a54de",
        "src/lib/markdown.test.tsx": "83c141811932fcd25cf6abcbe91fd99a0cc5c56e9ab0f0cb4782170b5ba796ae",
        "src/lib/markdown.tsx": "f41871ba359399c68025719bce7d9606e1aebce642cb06180683f8472a7576e7",
      }
    `);
  });
});
