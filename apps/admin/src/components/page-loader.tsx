import { NibleafMark } from '@nibleaf/design-system/brand';
import { useT } from '@nibleaf/i18n/react';

/** Full-screen branded loading state for the admin panel (session/data resolve). */
export function PageLoader() {
  const t = useT();
  return (
    <div className="grid min-h-screen w-full place-items-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <NibleafMark className="size-10 animate-pulse text-primary motion-reduce:animate-none" />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[pl-loading_1.1s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none" />
        </div>
        {/* Without motion nothing says "still loading", so the label shows. */}
        <span className="sr-only motion-reduce:not-sr-only motion-reduce:text-muted-foreground motion-reduce:text-sm">{t('common.loading')}</span>
      </div>
      <style>{'@keyframes pl-loading{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}'}</style>
    </div>
  );
}
