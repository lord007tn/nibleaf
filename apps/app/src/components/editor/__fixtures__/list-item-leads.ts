/*
 * The serializer corpus pages that load or save differently with list item leads
 * (#604, #865), by index, the one that trades a check, the pages whose quoted marks
 * this change writes correctly, and those whose code now gets a long enough fence (#920). list-item-leads-main.test.ts checks each against main's
 * record; the other differentials leave exactly these pages to it.
 */

import { serializerCorpus } from './serializer-corpus';

/** The corpus pages whose nodes or saves differ from main's. */
const LIST_ITEM_LEAD_PAGES: readonly number[] = [
  6, 11, 12, 15, 17, 23, 27, 33, 34, 37, 40, 42, 46, 48, 49, 54, 57, 58, 59, 62, 73, 75, 78, 79, 82, 84, 86, 87, 88, 89, 90, 94, 110, 115, 116, 117,
  122, 126, 127, 128, 129, 134, 135, 136, 155, 160, 162, 163, 168, 172, 173, 196, 199, 202, 208, 210, 214, 215, 224, 229, 233, 241, 246, 247, 250,
  255, 259, 260, 262, 263, 273, 276, 278, 279, 283, 286, 297, 302, 305, 309, 314, 319, 320, 324, 326, 327, 329, 339, 341, 345, 347, 352, 353, 365,
  368, 370, 371, 376, 377, 384, 391, 394, 401, 403, 406, 418, 425, 427, 434, 436, 438, 439, 442, 446, 447, 450, 453, 454, 456, 460, 465, 468, 470,
  472, 473, 476, 478, 486, 488, 494, 501, 502, 503, 504, 510, 511, 519, 521, 522, 542, 547, 549, 550, 552, 553, 554, 567, 568, 570, 573, 576, 588,
  591, 592, 594, 599, 601, 602, 603, 604, 605, 609, 613, 619, 621, 625, 626, 633, 638, 639, 643, 644, 646, 647, 649, 653, 658, 659, 666, 670, 672,
  673, 674, 680, 688, 692, 694, 699, 701, 702, 707, 709, 711, 719, 729, 734, 737, 746, 750, 752, 753, 754, 755, 763, 771, 772, 774, 776, 785, 786,
  790, 794, 797, 798, 809, 815, 838, 839, 844, 847, 853, 859, 860, 861, 866, 872, 873, 874, 875, 888, 895, 899, 902, 903, 905, 907, 909, 910, 915,
  918, 920, 925, 927, 937, 944, 955, 957, 963, 964, 970, 975, 976, 985, 986, 990, 997,
];

/**
 * Page 365 holds an ordered list inside a list item, and in it an item led by a
 * `<CodeGroup>` whose fence opens with a tab. Main moved the outer item's list out to the
 * page, where the component saved to a fixed point, but only after the save lost text
 * (460 visible characters after the corpus edits). The list now stays in its item, and the save
 * loses none unedited and one character edited; inside a list item, main itself
 * moves the list after that component into it on load (an HTML-led item, #871), so the
 * save is not yet a fixed point.
 */
export const LIST_ITEM_LEAD_TEXT_KEPT: readonly number[] = [365];

/**
 * The pages, with no list item lead, that main saves with a mark's delimiter doubled
 * (`****bold**`, `~~~~gone~~`) and, on most, the line's `>` left out. Each has a
 * paragraph that opens with bold, italic or strikethrough after another block in a quote
 * (in a list item, a callout or a component in it). The serializer's whitespace trim for
 * that mark started before the line's `>` prefix (markdown-output.ts), the trim this
 * change makes reachable in heading-led items in a quote. Each now writes the mark once,
 * on its `>` line.
 */
const QUOTED_MARK_PAGES: readonly number[] = [2, 65, 158, 426, 536, 773, 898, 977];

/**
 * #920: the pages, with no list item lead, holding a code block whose text has a line of
 * backticks or tildes that closed the fence main wrote it in (```` ``` ```` inside ```` ``` ````, mostly
 * an indented code block or a ````md```` fence quoting another), so the rest of the page read
 * back as code. Each now has a fence longer than that line (fence-source.ts `fenceOpenFor`).
 */
const FENCE_LENGTH_PAGES: readonly number[] = [
  67, 70, 83, 93, 106, 146, 206, 228, 236, 248, 252, 280, 423, 430, 479, 517, 556, 575, 656, 710, 717, 764, 784, 802, 825, 863, 879, 930,
];

/** Corpus edits that cross a bold boundary while a strike run is active. */
const NESTED_STRIKE_PAGES: readonly number[] = [220, 535, 894, 971];

/** Every page list-item-leads-main.test.ts checks against main, in order. */
export const LIST_ITEM_LEAD_DIFFERENTIAL_PAGES: readonly number[] = [
  ...LIST_ITEM_LEAD_PAGES,
  ...QUOTED_MARK_PAGES,
  ...FENCE_LENGTH_PAGES,
  ...NESTED_STRIKE_PAGES,
].sort((a, b) => a - b);

const sourcesOf = (indices: readonly number[]): ReadonlySet<string> => {
  const corpus = serializerCorpus();
  return new Set(indices.map((index) => corpus[index]?.source ?? ''));
};

/** The sources of the lead pages and the fence length pages (#920), for the differentials
 *  that hold the corpus among other pages: each one differs from main there too. */
export const listItemLeadSources = (attributeEdits = false): ReadonlySet<string> =>
  sourcesOf([
    ...LIST_ITEM_LEAD_PAGES,
    ...FENCE_LENGTH_PAGES.filter((index) => !attributeEdits || (index !== 70 && index !== 236)),
    ...(attributeEdits ? [] : NESTED_STRIKE_PAGES),
  ]);

/** The sources of the quoted mark pages, for the same differentials: one differs there only
 *  where that differential's saves hold the doubled mark, so each counts how many do. */
export const quotedMarkSources = (): ReadonlySet<string> => sourcesOf(QUOTED_MARK_PAGES);

// On these malformed task-list pages, the synthetic Card can be edited in the
// original document, but reloading the unedited save already drops the Card.
const ATTRIBUTE_SAVE_ONLY = sourcesOf([163, 280, 468, 576]);

/**
 * How the text a save reads back as differs from the text it was written from, counted as
 * multisets of characters both ways: `lost` the characters the reload no longer has,
 * `added` the ones it has that the document did not (a delimiter that reads back as
 * text, `****bold**`). Counting only lost characters let a save that loses one and adds
 * two pass as no worse than one that loses one.
 */
export function textChange(before: string, after: string): { lost: number; added: number } {
  const counts = new Map<string, number>();
  for (const character of before) counts.set(character, (counts.get(character) ?? 0) + 1);
  for (const character of after) counts.set(character, (counts.get(character) ?? 0) - 1);
  let lost = 0;
  let added = 0;
  for (const count of counts.values()) {
    if (count > 0) lost += count;
    else added -= count;
  }
  return { lost, added };
}

/**
 * Whether an attribute edit on a named page (its first node with `key` set to `Edited`,
 * as the attribute and frame differentials make) changed only what it edits: the edited
 * save has the save's lines, but for those that now hold `Edited`, and reloads with a node
 * holding it. Those differentials leave the named pages' digests to
 * list-item-leads-main.test.ts, which runs the corpus edits, not this one, so they check
 * this instead: a regression in the edited save fails it.
 */
export function attributeEditHolds(
  load: (markdown: string) => Iterable<Record<string, unknown>>,
  saved: string,
  edited: string | null,
  key: string,
  source: string,
): boolean {
  if (edited === null) return !ATTRIBUTE_SAVE_ONLY.has(source);
  const before = saved.split('\n');
  const after = edited.split('\n');
  if (ATTRIBUTE_SAVE_ONLY.has(source)) {
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [index]));
    if (before.length !== after.length || changed.length !== 1 || key !== 'title') return false;
    const [index = -1] = changed;
    const line = before[index] ?? '';
    return /^\s*(?:>\s*)?<Card title="x">$/.test(line) && after[index] === line.replace('title="x"', 'title="Edited"');
  }
  if (before.length !== after.length || after.some((line, index) => line !== before[index] && !line.includes('Edited'))) return false;
  for (const attrs of load(edited)) if (attrs[key] === 'Edited') return true;
  return false;
}
