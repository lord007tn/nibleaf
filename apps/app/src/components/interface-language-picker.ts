import { runSpeculative } from '@/lib/document-recovery';

/** Loads the interface-language picker dialog (cmdk and its dialog helpers).
 *  Its own module so the auth button can load it on demand, and tests can make
 *  the download fail.
 *
 *  The picker has an offline fallback, so a failed download must never cost the
 *  page. `runSpeculative` keeps the chunk-recovery listener (lib/chunk-reload.ts)
 *  from reloading the page over it. In a production build, Vite's preload helper
 *  then resolves the import to nothing instead of throwing, so a missing module
 *  rejects here and the button shows its fallback. */
export const loadInterfaceLanguagePicker = () =>
  runSpeculative(() => import('@/components/interface-language-dialog')).then((module) => {
    if (!module?.InterfaceLanguageDialog) throw new Error('The interface-language picker did not load.');
    return module.InterfaceLanguageDialog;
  });
