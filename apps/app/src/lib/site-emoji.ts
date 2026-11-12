/** A single emoji (one grapheme), or undefined. Emoji are text, never image
 *  URLs; where one becomes an SVG icon, encoding the SVG also escapes XML markup. */
export const siteEmoji = (value?: string | null): string | undefined => {
  const text = value?.trim();
  return text &&
    /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣)/u.test(text) &&
    Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length === 1
    ? text
    : undefined;
};
