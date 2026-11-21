import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { MARKDOWN_PARSE_LIMITS, type MarkdownParseOverflow } from '@nibleaf/shared/page-limits';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;

/** What a page's first parse-limit overflow tells its author: where, what, and the limit.
 *  Shared by the publish dialog and the editor's Fix bar, so both say the same thing. */
export const markdownLimitMessage = (t: Translate, locale: string, overflow: MarkdownParseOverflow): string => {
  const format = new Intl.NumberFormat(locale).format;
  if (overflow.limit === 'pageBytes')
    return t('publish.checks.markdownLimitPageBytes', {
      size: format(Math.ceil(overflow.amount / 1024)),
      limit: format(MARKDOWN_PARSE_LIMITS.pageBytes / 1024),
    });
  // A line number reads as the editor's gutter numbers it, without grouping.
  const values = { line: String(overflow.line), count: format(overflow.amount), limit: format(MARKDOWN_PARSE_LIMITS[overflow.limit]) };
  if (overflow.limit === 'lineCharacters') return t('publish.checks.markdownLimitLineCharacters', values);
  if (overflow.limit === 'syntaxMarkers') return t('publish.checks.markdownLimitSyntaxMarkers', values);
  return t(overflow.nesting === 'tags' ? 'publish.checks.markdownLimitNestingTags' : 'publish.checks.markdownLimitNesting', values);
};
