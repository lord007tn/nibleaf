import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';

type MarkdownNode = {
  type: string;
  name?: string | null;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** Patch only parsed link destinations; never serialize the tree back to MDX. */
export const preparePageLinks = (content: string) => {
  const destinations: { start: number; end: number; href: string }[] = [];
  const codeRanges: { start: number; end: number }[] = [];
  const collectCode = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'code' && start !== undefined && end !== undefined) codeRanges.push({ start, end });
    else for (const child of node.children ?? []) collectCode(child);
  };
  const visit = (node: MarkdownNode) => {
    if (node.type === 'html' || node.type === 'code' || node.type === 'inlineCode' || node.type.endsWith('Expression')) return;
    if (node.type.startsWith('mdxJsx') && node.name && /^[a-z]/.test(node.name)) return;
    if ((node.type === 'link' || node.type === 'definition') && node.url) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && codeRanges.some((range) => start >= range.start && end <= range.end)) return;
      const labelEnd =
        node.type === 'definition' ? start : (node.children?.at(-1)?.position?.end.offset ?? (start === undefined ? undefined : start + 1));
      if (start !== undefined && end !== undefined && labelEnd !== undefined) {
        const tail = content.slice(labelEnd, end);
        const opening = (node.type === 'definition' ? /^ {0,3}\[(?:\\.|[^\]\\])*\]:\s*(<?)/ : /^\]\(\s*(<?)/).exec(tail);
        if (opening) {
          const destinationStart = labelEnd + opening[0].length;
          let destinationEnd = destinationStart;
          let depth = 0;
          for (; destinationEnd < end; destinationEnd++) {
            const char = content[destinationEnd];
            if (char === '\\') {
              destinationEnd++;
              continue;
            }
            if (opening[1] === '<') {
              if (char === '>') break;
            } else {
              if ((char === ')' && depth === 0) || /\s/.test(char ?? '')) break;
              if (char === '(') depth++;
              if (char === ')') depth--;
            }
          }
          const href = content.slice(destinationStart, destinationEnd);
          destinations.push({ start: destinationStart, end: destinationEnd, href });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  try {
    const mdx = fromMarkdown(content, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
    // MDX disables indented code syntax; the editor also accepts CommonMark.
    // Use its code ranges only, never its link parse as a fallback for invalid MDX.
    collectCode(fromMarkdown(content));
    visit(mdx);
  } catch {
    return { rewrite: (_rewrite: (href: string) => string) => ({ content, linksUpdated: 0, documentsSkipped: 1 }) };
  }
  return {
    rewrite: (rewrite: (href: string) => string) => {
      let updated = content;
      let linksUpdated = 0;
      for (const destination of destinations.toReversed()) {
        const value = rewrite(destination.href);
        if (value === destination.href) continue;
        updated = updated.slice(0, destination.start) + value + updated.slice(destination.end);
        linksUpdated++;
      }
      return { content: updated, linksUpdated, documentsSkipped: 0 };
    },
  };
};

export const rewritePageLinks = (content: string, rewrite: (href: string) => string) => preparePageLinks(content).rewrite(rewrite);
