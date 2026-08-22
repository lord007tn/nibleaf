import { parseHTML } from 'linkedom';
import TurndownService from 'turndown/lib/turndown.browser.es.js';
import { gfm } from 'turndown-plugin-gfm';
import { appendVary } from '@/lib/request-negotiation';

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  headingStyle: 'atx',
  hr: '---',
});
turndown.use(gfm);

const escapeMarkdownTableCell = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

function extractMarkdownTables(content: Element, document: Document): Map<string, string> {
  const replacements = new Map<string, string>();
  for (const [index, table] of Array.from(content.querySelectorAll('table')).entries()) {
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((row) =>
        Array.from(row.children)
          .filter((cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD')
          .map((cell) => escapeMarkdownTableCell((cell.textContent ?? '').replace(/\s+/g, ' ').trim())),
      )
      .filter((row) => row.length > 0);
    if (rows.length === 0) continue;

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, column) => row[column] ?? ''));
    const header = normalized[0];
    if (!header) continue;
    const lines = [header, Array.from({ length: columnCount }, () => '---'), ...normalized.slice(1)].map((row) => `| ${row.join(' | ')} |`);
    const token = `NIBLEAFTABLEPLACEHOLDER${index}TOKEN`;
    const placeholder = document.createElement('p');
    placeholder.textContent = token;
    table.replaceWith(placeholder);
    replacements.set(token, lines.join('\n'));
  }
  return replacements;
}

/** Convert the server-rendered main landmark, not navigation/scripts, so the
 * Markdown representation stays equivalent to the human page without chrome. */
export function marketingHtmlToMarkdown(html: string, canonicalUrl: string): string {
  const { document } = parseHTML(html);
  const content = document.querySelector('main') ?? document.body;
  content.querySelectorAll('script, style, noscript, svg, button, [aria-hidden="true"]').forEach((node) => {
    node.remove();
  });

  for (const anchor of content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (href) anchor.setAttribute('href', new URL(href, canonicalUrl).toString());
  }
  for (const image of content.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src');
    if (src) image.setAttribute('src', new URL(src, canonicalUrl).toString());
  }

  // The upstream GFM table rule assumes a browser-only `table.rows` property.
  // Extract tables first so server-side LinkeDOM produces the same GFM syntax.
  const tables = extractMarkdownTables(content, document as unknown as Document);

  // Passing the already-parsed node keeps Turndown on its DOM-node path. Its
  // browser build otherwise expects a global `document` when given a string.
  let markdown = turndown.turndown(content as unknown as HTMLElement).trim();
  for (const [token, table] of tables) markdown = markdown.replace(token, table);
  return `${markdown}\n`;
}

export async function marketingMarkdownResponse(htmlResponse: Response, canonicalUrl: string): Promise<Response> {
  const body = marketingHtmlToMarkdown(await htmlResponse.text(), canonicalUrl);
  const response = new Response(body, {
    status: htmlResponse.status,
    headers: {
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
      'content-type': 'text/markdown; charset=utf-8',
    },
  });
  appendVary(response.headers, 'Accept');
  return response;
}

export function agentFriendlyNotFoundMarkdown(origin: string): Response {
  const response = new Response(
    `# 404 — Nibleaf page not found

The requested path does not exist. Use one of these machine-readable indexes to recover:

- [Nibleaf sitemap](${origin}/sitemap.xml)
- [Nibleaf agent index](${origin}/llms.txt)
- [Nibleaf developer resources](${origin}/developers)
- [Nibleaf product documentation](https://docs.nibleaf.com/)
`,
    {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/markdown; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
  );
  appendVary(response.headers, 'Accept');
  return response;
}
