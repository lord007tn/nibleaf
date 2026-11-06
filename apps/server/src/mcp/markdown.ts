import { parseFrontmatter } from '@/actions/importers/content';
import { AppError } from '@/errors';

/**
 * Largest Markdown document (UTF-8 bytes, after normalization) a write tool
 * accepts. JSON-escaping newlines and quotes grows the text, so the cap leaves
 * a third of the 192 KiB MCP request body (MAX_MCP_REQUEST_BODY_BYTES) for that
 * escaping and the JSON-RPC envelope; a test pins the relationship.
 */
export const MAX_MCP_MARKDOWN_BYTES = 128 * 1024;

/** Drop C0 control characters except tab and newline (NUL included). */
const stripControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a;
    })
    .join('');

/** Text as the editor and Git sync store it: LF line endings, no NUL or other
 *  C0 control characters except tab and newline. */
export const normalizeMcpMarkdown = (value: string): string => stripControlCharacters(value.replace(/\r\n?/g, '\n'));

/** A single-line field (title, description, icon): normalized, whitespace collapsed. */
export const normalizeMcpLine = (value: string): string => normalizeMcpMarkdown(value).replace(/\s+/g, ' ').trim();

export interface PreparedMarkdown {
  /** The page body without its frontmatter block. */
  body: string;
  /** Frontmatter title/description/icon, already normalized and length-capped
   *  like the Git sync import (200/500/64). Absent keys are undefined. */
  title?: string;
  description?: string;
  icon?: string;
}

const capped = (value: string | undefined, max: number) => {
  if (value === undefined) return;
  const line = normalizeMcpLine(value).slice(0, max);
  return line || undefined;
};

/** Normalize Markdown/MDX from a tool call and split a leading YAML frontmatter
 *  block with the same parser Git sync uses. Rejects documents over the cap. */
export const prepareMcpMarkdown = (markdown: string): PreparedMarkdown => {
  const normalized = normalizeMcpMarkdown(markdown);
  if (Buffer.byteLength(normalized, 'utf8') > MAX_MCP_MARKDOWN_BYTES) {
    throw new AppError({
      code: 'validation:failed',
      message: `Invalid arguments: markdown is larger than ${MAX_MCP_MARKDOWN_BYTES / 1024} KiB. Split the content into several pages.`,
    });
  }
  const { meta, body } = parseFrontmatter(normalized);
  return {
    body,
    title: capped(meta.title ?? meta.sidebartitle, 200),
    description: capped(meta.description, 500),
    icon: capped(meta.icon, 64),
  };
};
