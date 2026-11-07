import { Extension } from '@tiptap/core';
import { activeComponentTarget, type SettingsTarget } from '../component-settings/schema';

/** Opens the settings of the component around the caret. Shown in the gear's tooltip as "Alt+Enter" (⌥↩ on a Mac). */
const COMPONENT_SETTINGS_SHORTCUT = 'Alt-Enter';

export interface ComponentSettingsStorage {
  /** Set by the settings layer while it is mounted. */
  open: ((target: SettingsTarget) => void) | null;
}

declare module '@tiptap/core' {
  interface Storage {
    componentSettings: ComponentSettingsStorage;
  }
}

/**
 * Keyboard path to the component settings panel: Alt+Enter with the caret
 * inside a component (or the component selected) opens its settings, where
 * Escape closes them and returns to the same place in the text.
 */
export const ComponentSettings = Extension.create<Record<string, never>, ComponentSettingsStorage>({
  name: 'componentSettings',
  addStorage: () => ({ open: null }),
  addKeyboardShortcuts() {
    return {
      [COMPONENT_SETTINGS_SHORTCUT]: () => {
        const open = this.storage.open;
        const target = activeComponentTarget(this.editor.state);
        if (!open || !target || !this.editor.isEditable) return false;
        open(target);
        return true;
      },
    };
  },
});
