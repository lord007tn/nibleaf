/*
 * Vite writes the full preload list of a lazily imported module (every chunk it
 * depends on) into the chunk that imports it. Importing the chat UI from here,
 * rather than from the provider, keeps that list out of the public docs bundle:
 * the provider only lists this tiny module. The chunks the chat UI shares with
 * the reader are already loaded, so the extra hop costs no extra downloads.
 */
export const loadChatUi = () => import('./chat-ui');
