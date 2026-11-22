/*
 * The serializer corpus pages that load or save differently with list item leads
 * (#604, #865), by index, the one that trades a check, and the pages whose quoted marks
 * this change writes correctly. list-item-leads-main.test.ts checks each against main's
 * record; the other differentials leave exactly these pages to it.
 */

import { serializerCorpus } from './serializer-corpus';

/** The corpus pages whose nodes or saves differ from main's. */
const LIST_ITEM_LEAD_PAGES: readonly number[] = [
  6, 11, 12, 15, 17, 23, 27, 33, 34, 37, 40, 42, 46, 48, 49, 54, 57, 58, 59, 62, 73, 75, 78, 79, 82, 84, 86, 87, 88, 89, 90, 94, 110, 115, 116, 117,
  122, 126, 127, 128, 129, 134, 135, 136, 155, 160, 162, 163, 168, 172, 173, 196, 199, 202, 208, 210, 214, 215, 224, 229, 233, 241, 246, 247, 250,
  255, 259, 260, 262, 263, 273, 276, 278, 279, 283, 286, 297, 302, 305, 309, 314, 319, 320, 324, 326, 327, 329, 339, 341, 345, 347, 352, 353, 365,
  368, 370, 371, 376, 377, 384, 391, 394, 401, 403, 406, 418, 425, 427, 434, 436, 438, 439, 442, 446, 447, 450, 453, 454, 456, 460, 465, 468, 470,
  472, 473, 476, 478, 486, 488, 494, 501, 502, 503, 504, 510, 511, 519, 521, 522, 537, 542, 547, 549, 550, 552, 553, 554, 567, 568, 570, 573, 576,
  588, 591, 592, 594, 599, 601, 602, 603, 604, 605, 609, 613, 619, 621, 625, 626, 633, 638, 639, 643, 644, 646, 647, 649, 653, 658, 659, 666, 670,
  672, 673, 674, 680, 688, 692, 694, 699, 701, 702, 707, 709, 711, 719, 729, 734, 737, 746, 750, 752, 753, 754, 755, 763, 771, 772, 774, 776, 785,
  786, 790, 794, 797, 798, 809, 815, 838, 839, 844, 847, 853, 859, 860, 861, 866, 872, 873, 874, 875, 888, 895, 899, 902, 903, 905, 907, 909, 910,
  915, 918, 920, 925, 927, 937, 944, 955, 957, 963, 964, 970, 975, 976, 985, 986, 990, 997,
];

/**
 * Page 365 holds an ordered list inside a list item, and in it an item led by a
 * `<CodeGroup>` whose fence opens with a tab. Main moved the outer item's list out to the
 * page, where the component saved to a fixed point, but only after the save lost text
 * (396 characters after the corpus edits). The list now stays in its item, and the save
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

/** Every page list-item-leads-main.test.ts checks against main, in order. */
export const LIST_ITEM_LEAD_DIFFERENTIAL_PAGES: readonly number[] = [...LIST_ITEM_LEAD_PAGES, ...QUOTED_MARK_PAGES].sort((a, b) => a - b);

/**
 * Pages 324 and 570 open with a code block whose text holds a ``` fence line (an
 * indented code block in the source). Main writes it inside a ``` fence, so its reload
 * reads the rest of the page as code: the save fails every check but its source
 * structure, on main and now. The page's own Markdown then reads back as code text, and
 * that text is the save's: the lead-led lists in it keep their nesting now, so their
 * lines hold more indentation and their own markers, and on page 324 the code runs on
 * past an indented closing fence into the next one. More characters read back as code
 * than on main (the counts below), none more are lost, and the page's text is the same
 * before the save. The fence length is main's own serializer bug, not a list item's.
 */
export const SWALLOWED_BY_CODE: Readonly<Record<number, { plain: number; edited: number }>> = {
  324: { plain: 89, edited: 91 },
  570: { plain: 462, edited: 451 },
};

const sourcesOf = (indices: readonly number[]): ReadonlySet<string> => {
  const corpus = serializerCorpus();
  return new Set(indices.map((index) => corpus[index]?.source ?? ''));
};

/** The sources of the lead pages, for the differentials that hold the corpus among other
 *  pages: each one differs from main there too. */
export const listItemLeadSources = (): ReadonlySet<string> => sourcesOf(LIST_ITEM_LEAD_PAGES);

/** The sources of the quoted mark pages, for the same differentials: one differs there only
 *  where that differential's saves hold the doubled mark, so each counts how many do. */
export const quotedMarkSources = (): ReadonlySet<string> => sourcesOf(QUOTED_MARK_PAGES);

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
