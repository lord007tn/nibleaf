import { siteT } from '@nibleaf/i18n/site';
import { Link, ZoomIn } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function SectionLink({ id, language }: { id: string; language?: string }) {
  const [status, setStatus] = useState('');
  const t = siteT(language);
  async function copy() {
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      await navigator.clipboard.writeText(url.href);
      setStatus(t('copied'));
    } catch {
      setStatus(t('copyFailed'));
    }
  }
  return (
    <>
      <button type="button" className="reader-section-link reader-control" aria-label={t('copySectionLink')} onClick={copy}>
        <Link className="size-4" aria-hidden />
      </button>
      <span role="status" className="reader-copy-status">
        {status}
      </span>
    </>
  );
}

const isZoomable = (image: HTMLImageElement) =>
  !image.closest('a') && image.naturalWidth > 96 && image.naturalHeight > 96 && image.width > 64 && image.height > 64;

/** The sibling trigger keeps images valid inside paragraphs and avoids nested links. */
export function ContentImage({ language, ...props }: ComponentProps<'img'> & { language?: string }) {
  const [zoomable, setZoomable] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const t = siteT(language);
  // Server-rendered and cached images often finish loading before hydration,
  // when React's onLoad never fires; measure those on mount instead.
  useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth > 0) setZoomable(isZoomable(element));
  }, []);
  return (
    <span className="reader-image">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: load measures dimensions; interaction uses a separate button. */}
      <img
        {...props}
        ref={image}
        alt={props.alt ?? ''}
        onLoad={(event) => {
          props.onLoad?.(event);
          setZoomable(isZoomable(event.currentTarget));
        }}
      />
      {zoomable ? (
        <>
          <button
            ref={trigger}
            type="button"
            className="reader-image-zoom reader-control"
            aria-label={t('viewFullSize')}
            onClick={() => dialog.current?.showModal()}
          >
            <ZoomIn className="size-4" aria-hidden />
          </button>
          {/* A dialog is not phrasing content, so it must not live inside the image's paragraph. */}
          {createPortal(
            <dialog
              ref={dialog}
              className="reader-image-dialog"
              aria-label={t('viewFullSize')}
              onCancel={(event) => {
                event.preventDefault();
                dialog.current?.close();
              }}
              onClose={() => trigger.current?.focus()}
            >
              <button type="button" className="reader-control" onClick={() => dialog.current?.close()}>
                {t('closeImage')}
              </button>
              <img src={props.src} alt={props.alt ?? ''} />
            </dialog>,
            document.body,
          )}
        </>
      ) : null}
    </span>
  );
}
