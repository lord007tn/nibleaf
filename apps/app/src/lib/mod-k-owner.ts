/**
 * Marks an element that handles Ctrl/⌘+K itself: in the page editor the key adds
 * a link (audit AUTH-10). The app's command palette yields to the key inside one,
 * whatever order the keydown listeners run in. A read-only editor
 * (`contenteditable="false"`) does not claim the key.
 */
export const MOD_K_OWNER_ATTRIBUTE = 'data-mod-k-owner';

export function insideModKOwner(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const owner = target.closest(`[${MOD_K_OWNER_ATTRIBUTE}]`);
  return owner !== null && owner.getAttribute('contenteditable') !== 'false';
}
