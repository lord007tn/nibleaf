import { assetInMessage } from '@/lib/document-recovery';

/**
 * Whether a failed load came from a build the server no longer has: the asset it
 * asked for, or else this page's own entry script, is gone. Repeating such a
 * request can never succeed, so only loading the page again can recover. Offline,
 * or when the server cannot be asked, the answer is no: the page should wait.
 */
export async function isBuildRetired(error: unknown): Promise<boolean> {
  if (typeof document === 'undefined' || navigator.onLine === false) return false;
  const cause = (error as { cause?: unknown } | null | undefined)?.cause ?? error;
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  const asset = assetInMessage(message) ?? document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!asset) return false;
  try {
    const { status } = await fetch(asset, { method: 'HEAD', cache: 'no-store' });
    return status === 404 || status === 410;
  } catch {
    return false;
  }
}
