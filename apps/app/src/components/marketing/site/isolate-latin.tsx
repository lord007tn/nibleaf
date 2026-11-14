import type { ReactNode } from 'react';

/**
 * A run of Latin-script words (Nibleaf, Docker Compose, AGPL-3.0, v0.2.1,
 * support@nibleaf.com): it starts with a letter and ends with a letter or
 * digit, so the sentence's own punctuation stays outside it.
 */
const LATIN_RUN = /[A-Za-z](?:[\w.@/+:-]*[A-Za-z0-9])?(?:[ \t]+[A-Za-z0-9](?:[\w.@/+:-]*[A-Za-z0-9])?)*/g;

/**
 * Wraps each Latin run of an Arabic string in `<bdi>`, so product names,
 * versions and addresses keep their own left-to-right order inside the
 * right-to-left sentence and never pull neighbouring punctuation across.
 * English strings come back unchanged.
 */
export function isolateLatin(text: string, lang: 'en' | 'ar'): ReactNode {
  if (lang !== 'ar') return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<bdi key={start}>{match[0]}</bdi>);
    last = start + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
