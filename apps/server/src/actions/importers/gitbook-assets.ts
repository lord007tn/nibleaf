import { posix } from 'node:path';
import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { safeDecodeUri } from './gitbook-markdown';

/** `![alt](<path with spaces>)`, `![alt](path "title")`, and one level of
 * balanced parentheses in bare destinations (`image (1).png` after encoding). */
const MARKDOWN_IMAGE = /(!\[(?:\\.|[^\]\\])*\]\()(?:<([^>\n]+)>|((?:[^\s()]|\([^\s()]*\))+))((?:\s+["'][^"'\n]*["'])?\))/g;

const cleanReference = (value: string): string => safeDecodeUri(value.split(/[?#]/, 1)[0] ?? value);

/**
 * Resolve a GitBook asset/include reference to a repository path. References
 * are relative to the page file; a leading slash is relative to the space root.
 * GitBook also tolerates `.gitbook/assets/x` written from a nested page (it
 * resolves assets by name), so the space's — then the repo's — asset folder is
 * tried as a fallback before giving up.
 */
export const resolveGitBookRepoPath = (reference: string, sourceFile: string, blobs: ReadonlySet<string>, spaceRoot: string): string | undefined => {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) return undefined;
  const clean = cleanReference(reference.trim()).replace(/\\/g, '/');
  const candidates = [
    posix.normalize(clean.startsWith('/') ? posix.join(spaceRoot || '.', clean.slice(1)) : posix.join(posix.dirname(sourceFile), clean)),
  ];
  const assetName = clean.match(/(?:^|\/)\.gitbook\/assets\/(.+)$/)?.[1];
  if (assetName) {
    candidates.push(posix.join(spaceRoot || '.', '.gitbook/assets', assetName), posix.join('.gitbook/assets', assetName));
  }
  return candidates.map((path) => path.replace(/^\.\//, '')).find((path) => path !== '.' && !path.startsWith('../') && blobs.has(path));
};

/** raw.githubusercontent URLs keep `(`/`)` unencoded, which would end a
 * Markdown destination early. Encode them so later regex passes see one URL. */
export const encodeMarkdownUrl = (url: string): string => url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');

export interface GitBookAssetRewriteResult {
  content: string;
  missing: string[];
}

/** Point repository images at absolute source URLs. RemoteAssetMigrator then
 * copies those into project storage, exactly like the Mintlify importer. */
export const rewriteGitBookImages = (
  content: string,
  sourceFile: string,
  blobs: ReadonlySet<string>,
  spaceRoot: string,
  rawUrl: (path: string) => string,
): GitBookAssetRewriteResult => {
  const missing = new Set<string>();
  const protectedCode = protectMarkdownCode(content, { maxFenceIndent: Number.POSITIVE_INFINITY });
  const rewritten = protectedCode.content.replace(
    MARKDOWN_IMAGE,
    (match, before: string, bracketed: string | undefined, bare: string | undefined, after: string) => {
      const reference = bracketed ?? bare ?? '';
      if (/^https?:\/\//i.test(reference)) return `${before}${encodeMarkdownUrl(reference)}${after}`;
      if (/^(?:data:|blob:|#)/i.test(reference)) return match;
      const path = resolveGitBookRepoPath(reference, sourceFile, blobs, spaceRoot);
      if (!path) {
        missing.add(reference);
        return match;
      }
      return `${before}${encodeMarkdownUrl(rawUrl(path))}${after}`;
    },
  );
  return { content: protectedCode.restore(rewritten), missing: [...missing] };
};
