import { NibleafMark } from '@nibleaf/design-system/brand';
import { useStandaloneT } from '@nibleaf/i18n/standalone';

/**
 * Full-screen branded loading state shown during route transitions that fetch
 * data (wired as the router's `defaultPendingComponent`). Uses the small
 * standalone Paraglide surface so it renders before product providers mount.
 */
export function PageLoader() {
  const t = useStandaloneT();
  return (
    <div className="grid min-h-screen w-full place-items-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <NibleafMark className="size-10 animate-pulse text-primary" />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[pl-loading_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
        <span className="sr-only">{t('common.loading')}</span>
      </div>
      <style>{'@keyframes pl-loading{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}'}</style>
    </div>
  );
}
