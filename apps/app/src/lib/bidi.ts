/**
 * Wrap user text (a domain, a site name) in Unicode isolates (FSI … PDI) before it
 * goes into a translated sentence, so it keeps its own reading direction: a Latin
 * domain inside an Arabic sentence doesn't drag the punctuation around it.
 */
export const isolate = (value: string): string => `\u2068${value}\u2069`;
