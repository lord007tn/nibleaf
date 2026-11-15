import CharacterCount, { type CharacterCountOptions } from '@tiptap/extension-character-count';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';

/*
 * The footer's word and character counts (P2-ED-005). CharacterCount reads the
 * whole document's text on every call, and the footer asks on every transaction,
 * several times per keystroke. The counts here are the same numbers, summed from
 * counts kept per top-level block. Nodes never change, so a block's counts are
 * cached on the node itself: a keystroke recounts only the block it changed.
 *
 * Why the sum is exact, with CharacterCount's default counters:
 * - characters: `textBetween(0, size, undefined, ' ')` puts no separator between
 *   blocks, so the text is each block's text in turn;
 * - words: `textBetween(0, size, ' ', ' ')` splits on single spaces and puts a
 *   space before every textblock and block leaf but the first. All text sits in
 *   textblocks or leaves, so each top-level block's text starts after a space,
 *   and no word spans two of them.
 */

export interface TextCounts {
  words: number;
  characters: number;
}

const blockCounts = new WeakMap<PMNode, TextCounts>();
const documentCounts = new WeakMap<PMNode, TextCounts>();

// CharacterCount's default counters, named so the extension can tell they are in use.
const countCharacters = (text: string) => text.length;
const countWords = (text: string) => text.split(' ').filter((word) => word !== '').length;

function countBlock(block: PMNode): TextCounts {
  let counts = blockCounts.get(block);
  if (!counts) {
    // The block as the only child of a fragment: read exactly as the document read covers it.
    const alone = Fragment.from(block);
    counts = {
      words: countWords(alone.textBetween(0, alone.size, ' ', ' ')),
      characters: countCharacters(alone.textBetween(0, alone.size, undefined, ' ')),
    };
    blockCounts.set(block, counts);
  }
  return counts;
}

/** The words and characters CharacterCount reports for `doc`, from cached block counts. */
export function countText(doc: PMNode): TextCounts {
  let counts = documentCounts.get(doc);
  if (!counts) {
    let words = 0;
    let characters = 0;
    doc.forEach((block) => {
      const own = countBlock(block);
      words += own.words;
      characters += own.characters;
    });
    counts = { words, characters };
    documentCounts.set(doc, counts);
  }
  return counts;
}

type CountOptions = { node?: PMNode; mode?: 'textSize' | 'nodeSize' };

/**
 * CharacterCount whose `words()` and `characters()` for the editor's document come
 * from `countText`. Any other question (another node, another mode, custom
 * counters) goes to CharacterCount's own count.
 */
export const CachedCharacterCount = CharacterCount.extend({
  addOptions() {
    return { ...(this.parent?.() as CharacterCountOptions), textCounter: countCharacters, wordCounter: countWords };
  },
  onBeforeCreate() {
    this.parent?.();
    const storage = this.storage as { words: (options?: CountOptions) => number; characters: (options?: CountOptions) => number };
    const ownWords = storage.words;
    const ownCharacters = storage.characters;
    const cacheable = (options?: CountOptions) =>
      !options?.node &&
      (options?.mode ?? this.options.mode) === 'textSize' &&
      this.options.textCounter === countCharacters &&
      this.options.wordCounter === countWords;
    storage.words = (options) => (cacheable(options) ? countText(this.editor.state.doc).words : ownWords(options));
    storage.characters = (options) => (cacheable(options) ? countText(this.editor.state.doc).characters : ownCharacters(options));
  },
});
