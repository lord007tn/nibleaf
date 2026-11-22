import {
  AFTER_CONTINUATION,
  AFTER_FENCE,
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  continuationFenceCases,
  differentialCases,
  FENCE_CONTAINER_REPROS,
  fenceCases,
  HTML_BLOCK_HEADING_REPROS,
  HTML_BLOCK_REPEATED_HEADING,
  HTML_BLOCK_WITHOUT_BLANK,
  HTML_COMMENT_WITH_BANG_CLOSER,
  INDENTED_FENCE_AFTER_QUOTE,
  indentedLookalikeCases,
  LAZY_INLINE_HTML_REPROS,
  LAZY_TEXT_AFTER_INLINE_HTML,
  ORDERED_LINE_UNDER_BULLET,
  QUOTED_DOCTYPE_BLOCK,
  quoteCloserIndentationCases,
  TAB_BEFORE_QUOTE_IN_ITEM,
} from './fence-cases';

/**
 * Every source the reader scanner's own tests generate or pin (#587, #590 and
 * their reviews), grouped by family: the reader/tokenizer differential for
 * #591 runs each through both. `fenceCases` is #590's property generator
 * (seed 0x58236b09).
 */
export const readerFenceDifferentialFamilies = (): Array<{ name: string; sources: string[] }> => [
  {
    name: 'reader repros',
    sources: [
      ...FENCE_CONTAINER_REPROS.flatMap(([, source]) => [source, `${source}${AFTER_FENCE}`, `${source}\n\n<Note>After</Note>`]),
      ...[...CONTINUATION_FENCE_REPROS, ...CODERABBIT_REPROS, ...LAZY_INLINE_HTML_REPROS].map(([, source]) => `${source}${AFTER_CONTINUATION}`),
      ...HTML_BLOCK_HEADING_REPROS.map(([, source]) => source),
      INDENTED_FENCE_AFTER_QUOTE,
      ORDERED_LINE_UNDER_BULLET[0],
      LAZY_TEXT_AFTER_INLINE_HTML.source,
      TAB_BEFORE_QUOTE_IN_ITEM[0],
      HTML_COMMENT_WITH_BANG_CLOSER,
      HTML_BLOCK_REPEATED_HEADING,
      QUOTED_DOCTYPE_BLOCK.source,
      HTML_BLOCK_WITHOUT_BLANK,
    ],
  },
  { name: 'fence property (seed 0x58236b09)', sources: fenceCases().map(({ source }) => source) },
  { name: 'indented lookalikes', sources: indentedLookalikeCases().map(({ source }) => source) },
  { name: 'continuation fences', sources: continuationFenceCases().map(({ source }) => source) },
  { name: 'CommonMark differential', sources: differentialCases().map(({ source }) => source) },
  { name: 'quote closer indentation', sources: quoteCloserIndentationCases().map(({ source }) => source) },
];
