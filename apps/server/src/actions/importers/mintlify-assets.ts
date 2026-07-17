import { posix } from 'node:path';

const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()([^\s)]+)((?:\s+["'][^)]*["'])?\))/g;
const HTML_IMAGE = /(<(?:img|Image)\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi;

const cleanReference = (value: string): string => {
  const withoutSuffix = value.split(/[?#]/, 1)[0] ?? value;
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    return withoutSuffix;
  }
};

const repoPathForReference = (reference: string, sourceFile: string): string | null => {
  if (/^(?:https?:|data:|blob:|#)/i.test(reference)) return null;
  const clean = cleanReference(reference).replace(/\\/g, '/');
  const path = posix.normalize(clean.startsWith('/') ? clean.slice(1) : posix.join(posix.dirname(sourceFile), clean));
  return !path || path === '.' || path.startsWith('../') ? null : path;
};

export interface MintlifyAssetRewriteResult {
  content: string;
  /** Repo files that were converted to absolute source URLs. */
  resolved: string[];
  /** Relative references that did not exist in the repository tree. */
  missing: string[];
}

/** Resolve Markdown and MDX/HTML image paths relative to their source file.
 * The returned absolute URLs are subsequently copied by RemoteAssetMigrator. */
export const rewriteMintlifyAssetReferences = (
  content: string,
  sourceFile: string,
  blobs: ReadonlySet<string>,
  rawUrl: (path: string) => string,
): MintlifyAssetRewriteResult => {
  const resolved = new Set<string>();
  const missing = new Set<string>();
  const resolve = (reference: string): string => {
    if (/^https?:\/\//i.test(reference)) return reference;
    const path = repoPathForReference(reference, sourceFile);
    if (!path) return reference;
    if (!blobs.has(path)) {
      missing.add(reference);
      return reference;
    }
    resolved.add(path);
    return rawUrl(path);
  };
  const markdown = content.replace(
    MARKDOWN_IMAGE,
    (_match, before: string, reference: string, after: string) => `${before}${resolve(reference)}${after}`,
  );
  const rewritten = markdown.replace(
    HTML_IMAGE,
    (_match, before: string, reference: string, after: string) => `${before}${resolve(reference)}${after}`,
  );
  return { content: rewritten, resolved: [...resolved], missing: [...missing] };
};

/** Resolve a config-level asset path relative to the Mintlify config directory. */
export const resolveMintlifyConfigAsset = (
  reference: string,
  configPath: string,
  blobs: ReadonlySet<string>,
  rawUrl: (path: string) => string,
): string | undefined => {
  if (/^https?:\/\//i.test(reference)) return reference;
  const path = repoPathForReference(reference, configPath);
  return path && blobs.has(path) ? rawUrl(path) : undefined;
};
