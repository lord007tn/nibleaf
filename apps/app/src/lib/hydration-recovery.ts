import type { Locale } from '@nibleaf/i18n/locales';
import { translateStandalone } from '@nibleaf/i18n/standalone';

/**
 * A small notice with one action. Plain DOM, in the always-loaded chunk, so it
 * works before React starts and when no other chunk can be fetched. React's root
 * may already hold every click on the document until hydration finishes, so the
 * button is handled on `window`, ahead of it.
 */
export function showRecoveryNotice(locale: Locale, onAction: () => void, label = translateStandalone('error.tryAgain', locale)) {
  const notice = document.createElement('div');
  const message = document.createElement('p');
  const action = document.createElement('button');
  const onClick = (event: Event) => {
    if (event.target !== action) return;
    event.stopPropagation();
    onAction();
  };
  notice.setAttribute('role', 'alert');
  notice.lang = locale;
  notice.className =
    'fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg';
  message.textContent = translateStandalone('error.unexpected', locale);
  action.type = 'button';
  action.className = 'min-h-9 shrink-0 rounded-md border px-3 font-medium';
  action.textContent = label;
  notice.append(message, action);
  document.body.append(notice);
  window.addEventListener('click', onClick, true);
  return {
    action,
    remove() {
      window.removeEventListener('click', onClick, true);
      notice.remove();
    },
  };
}
