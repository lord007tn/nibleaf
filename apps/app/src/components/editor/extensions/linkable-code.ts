import Code from '@tiptap/extension-code';

/**
 * The marks inline code still keeps out: every mark in the editor's schema
 * except `link`. TipTap's Code mark excludes all of them (`excludes: '_'`), so a
 * link whose label is inline code, ``[`npm i`](/x)``, parsed as plain code, and
 * a label mixing text and code split into one link per text run (#660). Bold,
 * italic and the rest still cannot sit on code text, as before.
 *
 * ProseMirror rejects a name that is not a mark in the schema, and a mark added
 * to the editor later would be allowed on code until it is listed here, so the
 * test in code-label-links.test.ts checks the list against the schema's marks.
 */
const CODE_EXCLUDED_MARKS = ['bold', 'code', 'italic', 'strike', 'underline', 'highlight', 'subscript', 'superscript'] as const;

/** TipTap's inline code, which a link can wrap. */
export const LinkableCode = Code.extend({
  excludes: CODE_EXCLUDED_MARKS.join(' '),
});
