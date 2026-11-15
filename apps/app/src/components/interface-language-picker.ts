import { runOptionalLoad } from '@/lib/document-recovery';

/** Loads the interface-language picker dialog (cmdk and its dialog helpers).
 *  Its own module so the auth button can load it on demand, and tests can make
 *  the download fail.
 *
 *  The picker has an offline fallback, so a failed download must never cost the
 *  page. `runOptionalLoad` claims this load's own failure, so the chunk-recovery
 *  listener (lib/chunk-reload.ts) doesn't reload the page over it; the button
 *  shows its fallback instead. A module that comes back without the dialog
 *  counts as a failure too. */
export const loadInterfaceLanguagePicker = () =>
  runOptionalLoad(() => import('@/components/interface-language-dialog')).then((module) => {
    if (!module?.InterfaceLanguageDialog) throw new Error('The interface-language picker did not load.');
    return module.InterfaceLanguageDialog;
  });
