import { trimmedText } from '@/lib/search-params';

/** The reader layout's `?ask=` deep link: 2 to 500 characters once trimmed.
 * It lives apart from the panel's helpers, so the eager route doesn't pull them
 * into the public docs bundle. */
export const readAskSearch = trimmedText(2, 500);
