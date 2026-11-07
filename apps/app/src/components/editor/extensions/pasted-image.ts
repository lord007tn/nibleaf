import { translateFn } from '@nibleaf/i18n';
import { presignAssetBody } from '@nibleaf/validators';
import { toast } from 'sonner';
import { normalizedURL } from './html-safety';

/** Check MIME and decoded byte size before allocating an inline clipboard image. */
export function fileFromPastedImage(source: string): File | null {
  const comma = source.indexOf(',');
  const metadata = (normalizedURL(source.slice(0, comma)) ?? '').slice(5).split(';');
  const contentType = metadata[0]?.toLowerCase() ?? '';
  const content = source.slice(comma + 1).replace(/\s/g, '');
  const size = Math.floor((content.length * 3) / 4) - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0);
  const fail = (tooLarge = false) => {
    toast.error(translateFn(tooLarge ? 'editor.image.tooLarge' : 'editor.image.wrongType'));
    return null;
  };
  if (size > 50 * 1024 * 1024) return fail(true);
  if (
    comma < 0 ||
    !metadata.some((part) => part.toLowerCase() === 'base64') ||
    !presignAssetBody.safeParse({ filename: 'pasted-image', contentType, size }).success
  )
    return fail();
  try {
    const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.includes('icon') ? 'ico' : contentType.split('/')[1];
    return new File([bytes], `pasted-image.${extension}`, { type: contentType });
  } catch {
    return fail();
  }
}
