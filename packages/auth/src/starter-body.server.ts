import { createHash } from 'node:crypto';

/** Keep creation and detection aligned with the legacy whitespace comparison. */
export const normalizeStarterBody = (content: string): string => content.replace(/\s+/g, ' ').trim();

/** Hash the stored Markdown, before publish-time variable interpolation. */
export const starterBodyHash = (content: string): string => createHash('sha256').update(normalizeStarterBody(content), 'utf8').digest('hex');
