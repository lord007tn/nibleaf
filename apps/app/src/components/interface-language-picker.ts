/** Loads the interface-language picker dialog (cmdk and its dialog helpers).
 *  Its own module so the auth button can load it on demand, and tests can make
 *  the download fail. */
export const loadInterfaceLanguagePicker = () => import('@/components/interface-language-dialog').then((module) => module.InterfaceLanguageDialog);
