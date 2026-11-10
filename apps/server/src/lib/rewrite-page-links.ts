import { fromMarkdown } from 'mdast-util-from-markdown';

type MarkdownNode = {
  type: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** Patch only parsed link destinations; never serialize the tree back to MDX. */
export const rewritePageLinks = (content: string, rewrite: (href: string) => string): { content: string; linksUpdated: number } => {
  const edits: { start: number; end: number; value: string }[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'link' && node.url) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const labelEnd = node.children?.at(-1)?.position?.end.offset ?? (start === undefined ? undefined : start + 1);
      if (start !== undefined && end !== undefined && labelEnd !== undefined) {
        const tail = content.slice(labelEnd, end);
        const opening = /^\]\(\s*(<?)/.exec(tail);
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
          const value = rewrite(href);
          if (href !== value) edits.push({ start: destinationStart, end: destinationEnd, value });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(content));
  let updated = content;
  for (const edit of edits.reverse()) updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
  return { content: updated, linksUpdated: edits.length };
};
