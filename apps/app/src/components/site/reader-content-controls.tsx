import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Link, ZoomIn } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

let liveRegion: HTMLElement | null = null;

/** One shared polite live region for reader controls (copy code, copy section
 * link), instead of a status element per heading and code block. */
export function announce(message: string): void {
  if (typeof document === 'undefined') return;
  if (!liveRegion?.isConnected) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('data-reader-announcer', '');
    liveRegion.className = 'sr-only';
    document.body.append(liveRegion);
  }
  const region = liveRegion;
  // Clear first so repeating the same message is announced again.
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

export function SectionLink({ id, language }: { id: string; language?: string }) {
  const t = siteContentT(language);
  async function copy() {
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      await navigator.clipboard.writeText(url.href);
      announce(t('copied'));
    } catch {
      announce(t('copyFailed'));
    }
  }
  return (
    // The heading (its id) describes each button, so a list of buttons tells them apart.
    // `lang`: its label is the reader's, which can differ from the article's on a fallback page.
    <button
      type="button"
      className="reader-section-link reader-control"
      aria-label={t('copySectionLink')}
      aria-describedby={id}
      lang={language}
      onClick={copy}
    >
      <Link className="size-4" aria-hidden />
    </button>
  );
}

const isZoomable = (image: HTMLImageElement) =>
  !image.closest('a') && image.naturalWidth > 96 && image.naturalHeight > 96 && image.width > 64 && image.height > 64;

// Display and auto-margin utilities, with any variants (`dark:hidden`, `md:block`, `mx-auto`).
const WRAPPER_CLASS = /^(?:[\w-]+:)*(?:hidden|block|inline|inline-block|flex|inline-flex|grid|contents|mx-auto|ms-auto|me-auto)$/;

/** The sibling trigger keeps images valid inside paragraphs and avoids nested links. */
export function ContentImage({ language, className, ...props }: ComponentProps<'img'> & { language?: string }) {
  // The image keeps every authored class. The wrapper copies its display and
  // auto-margin classes, so a light/dark image pair hides its zoom button too and
  // `block mx-auto` still centers (the wrapper shrinks to the image and centers).
  const wrapperClassName = (className ?? '')
    .split(/\s+/)
    .filter((name) => WRAPPER_CLASS.test(name))
    .join(' ');
  const [zoomable, setZoomable] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const t = siteContentT(language);
  // Server-rendered and cached images often finish loading before hydration, when
  // React's onLoad never fires, and an image hidden for the other appearance only
  // gets a size once revealed; measure on mount and whenever its size changes.
  useEffect(() => {
    const element = image.current;
    if (!element) return;
    const measure = () => {
      if (element.complete && element.naturalWidth > 0) setZoomable(isZoomable(element));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const alt = props.alt?.trim();
  const openFullSize = () => {
    const modal = dialog.current;
    const source = trigger.current;
    if (!modal || !source) return;
    // The dialog is portaled out of the article, so carry over its direction. Its
    // text (the close button) is the reader's, so it takes the reader's language.
    modal.dir = getComputedStyle(source).direction === 'rtl' ? 'rtl' : 'ltr';
    const lang = language ?? source.closest('[lang]')?.getAttribute('lang');
    if (lang) modal.lang = lang;
    modal.showModal();
  };
  return (
    <span className={cn('reader-image relative inline-block max-w-full', wrapperClassName, wrapperClassName && 'w-fit')}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: load measures dimensions; interaction uses a separate button. */}
      <img
        {...props}
        className={className}
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
            aria-label={alt ? t('viewFullSizeOf', { alt }) : t('viewFullSize')}
            lang={language}
            onClick={openFullSize}
          >
            <ZoomIn className="size-4" aria-hidden />
          </button>
          {/* A dialog is not phrasing content, so it must not live inside the image's paragraph. */}
          {createPortal(
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape already closes the native dialog; the click only handles the backdrop.
            <dialog
              ref={dialog}
              className="reader-image-dialog"
              aria-label={alt || t('viewFullSize')}
              onCancel={(event) => {
                event.preventDefault();
                dialog.current?.close();
              }}
              onClose={() => trigger.current?.focus()}
              onClick={(event) => {
                // A click on the dialog element itself (not its content) is a backdrop click.
                if (event.target === event.currentTarget) dialog.current?.close();
              }}
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
