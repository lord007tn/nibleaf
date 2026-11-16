/**
 * Preparing a Ghost import, as pure logic: what is refused before the file is
 * read, and the request built from what was read. Driven by
 * `components/use-ghost-import.ts`; tested in `ghost-import.test.ts`.
 *
 * The server stays the authority on the export's shape. Here a file is only
 * refused when it is too large to send, or when its text is not a JSON object.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { ghostImportBody } from '@nibleaf/validators';

/** Matches the server-side body cap for Ghost exports. */
export const MAX_GHOST_FILE_BYTES = 15 * 1024 * 1024;

/** A Ghost import as sent. It names the site it is for, whatever the page shows by the time it settles. */
export type GhostImportRequest = { projectId: string; body: Record<string, unknown> };

/** An http(s) URL with a host and no credentials in it. */
export const isValidImportUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Why an import is refused before its file is read (the site URL first, then the size), or null to read it. */
export const ghostImportRefusal = ({ fileSize, ghostUrl }: { fileSize: number; ghostUrl: string }): MessageKey | null => {
  if (!isValidImportUrl(ghostUrl)) return 'settings.import.ghost.invalidUrl';
  if (fileSize > MAX_GHOST_FILE_BYTES) return 'settings.import.ghost.tooLarge';
  return null;
};

/**
 * The body for the file's text: the export itself, with the Ghost site's URL
 * under `__nibleafImport`. Null when the text is not JSON, or is JSON but not
 * an object.
 */
export const ghostImportRequestBody = (text: string, ghostUrl: string): Record<string, unknown> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const document = ghostImportBody.safeParse(parsed);
  return document.success ? { ...document.data, __nibleafImport: { ghostUrl } } : null;
};

/** Whether a pending request (as the mutation cache holds it) is a Ghost import for this site. */
export const isGhostImportFor = (variables: unknown, projectId: string): boolean =>
  typeof variables === 'object' && variables !== null && (variables as Record<string, unknown>).projectId === projectId;
