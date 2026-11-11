/** What a list shows for a person: a primary line, an optional secondary line and initials. */
export interface PersonDisplay {
  primary: string;
  secondary: string | null;
  initials: string;
}

const letters = (part: string) => [...part].find((char) => /\p{L}|\p{N}/u.test(char)) ?? '';

/**
 * Initials from a name ("Lina Mansour" → "LM"), or from an email's local part
 * when there is no name ("lina.mansour@…" → "LM", "lina@…" → "LI"), never a
 * placeholder letter (WORKSPACE-25).
 */
export function initialsFor(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  const source = trimmed || email.split('@')[0] || email;
  const parts = source.split(trimmed ? /\s+/ : /[._+\-\s]+/).filter((part) => letters(part));
  if (parts.length >= 2) return `${letters(parts[0] ?? '')}${letters(parts[parts.length - 1] ?? '')}`.toUpperCase();
  const only = [...(parts[0] ?? source)].filter((char) => /\p{L}|\p{N}/u.test(char));
  return only.slice(0, 2).join('').toUpperCase() || '?';
}

/** A nameless person is their email: email first, no empty second line. */
export function personDisplay(user: { name?: string | null; email: string }): PersonDisplay {
  const name = user.name?.trim();
  return { primary: name || user.email, secondary: name ? user.email : null, initials: initialsFor(name, user.email) };
}

/** Case- and accent-insensitive "does this person match the search box". */
export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return true;
  return fields.some((field) => field && normalize(field).includes(needle));
}
