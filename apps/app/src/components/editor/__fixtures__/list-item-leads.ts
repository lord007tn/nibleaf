/*
 * The serializer corpus pages that load or save differently with list item leads
 * (#604, #865), by index, and the one that trades a check. list-item-leads-main.test.ts
 * checks each against main's record; the other differentials leave exactly these
 * pages to it.
 */

import { serializerCorpus } from './serializer-corpus';

/** The corpus pages whose nodes or saves differ from main's. */
export const LIST_ITEM_LEAD_PAGES: readonly number[] = [
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

/** The sources of the named pages, for the differentials that hold the corpus among other pages. */
export function listItemLeadSources(): ReadonlySet<string> {
  const corpus = serializerCorpus();
  return new Set(LIST_ITEM_LEAD_PAGES.map((index) => corpus[index]?.source ?? ''));
}
