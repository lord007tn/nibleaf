import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n/react';
import type { Editor, Range } from '@tiptap/core';
import type { ComponentType } from 'react';

interface SlashCommandProps {
  editor: Editor;
  range: Range;
  /** Language of the page being edited — inserted scaffold text follows it, not the dashboard locale. */
  locale: Locale;
}

export interface SlashItem {
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  /** Short mono glyph shown in the 32px tile (matches the design's monospace tiles). */
  glyph: string;
  keywords?: string[];
  command: (props: SlashCommandProps) => void;
}

/** Uploads a picked image and returns its hosted URL (or null on failure). */
export type UploadFn = (file: File) => Promise<string | null>;

/** Default text for an inserted block, written in the page language (an Arabic
 *  page gets Arabic placeholders whatever the dashboard locale is). */
export const scaffoldText = (key: MessageKey, locale: Locale, variables?: MessageVariables): string => translateFn(key, variables, locale);
