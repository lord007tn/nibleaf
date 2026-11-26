import type { Editor, JSONContent } from '@tiptap/core';

// Zero-based serializer corpus pages whose authored #625 layout changes the saved Markdown.
export const COMPONENT_LAYOUT_CORPUS_PAGES: readonly number[] = [
  20, 30, 36, 43, 48, 49, 52, 54, 55, 57, 62, 68, 73, 74, 87, 94, 105, 115, 116, 133, 134, 136, 139, 144, 148, 149, 161, 168, 169, 175, 178, 184, 208,
  212, 218, 220, 232, 236, 246, 256, 259, 264, 269, 294, 304, 308, 309, 317, 319, 321, 326, 328, 330, 347, 349, 357, 365, 366, 368, 378, 382, 384,
  391, 397, 403, 404, 406, 410, 412, 426, 441, 446, 458, 469, 478, 482, 486, 494, 505, 507, 519, 525, 533, 536, 538, 539, 542, 547, 564, 565, 566,
  577, 578, 580, 584, 588, 589, 593, 601, 602, 606, 611, 617, 621, 626, 630, 633, 640, 653, 656, 658, 661, 662, 678, 688, 696, 705, 710, 721, 722,
  731, 732, 734, 735, 736, 739, 754, 757, 758, 763, 767, 774, 782, 783, 785, 792, 800, 811, 814, 816, 835, 840, 846, 852, 859, 860, 866, 875, 876,
  884, 898, 899, 903, 909, 913, 915, 929, 937, 940, 946, 947, 966, 967, 976, 977, 981, 989, 990,
];

// The same corpus already changes on the second unedited save for these pages
// on main at 3d23d2923. Every other page must save to a fixed point.
export const MAIN_SECOND_SAVE_CHANGES: readonly number[] = [
  2, 6, 9, 11, 15, 17, 19, 27, 34, 36, 37, 42, 43, 46, 47, 48, 49, 51, 54, 57, 58, 65, 67, 75, 79, 82, 83, 84, 86, 88, 89, 90, 93, 94, 97, 106, 115,
  116, 117, 119, 122, 126, 127, 128, 129, 134, 135, 136, 146, 147, 155, 156, 158, 160, 162, 163, 168, 172, 173, 175, 178, 189, 196, 199, 202, 206,
  208, 228, 229, 246, 247, 248, 250, 251, 252, 255, 259, 260, 261, 262, 263, 265, 273, 276, 278, 280, 289, 302, 303, 305, 306, 309, 314, 319, 324,
  326, 327, 339, 341, 345, 347, 352, 353, 366, 368, 370, 371, 376, 377, 384, 386, 390, 391, 394, 397, 403, 406, 422, 425, 426, 427, 434, 438, 441,
  442, 446, 447, 450, 453, 456, 460, 465, 468, 472, 473, 479, 486, 488, 489, 492, 494, 499, 501, 502, 503, 510, 511, 513, 517, 521, 522, 523, 536,
  537, 547, 549, 551, 552, 553, 554, 556, 568, 570, 573, 575, 576, 580, 588, 591, 592, 599, 601, 605, 609, 613, 616, 623, 624, 625, 626, 637, 638,
  639, 643, 644, 646, 647, 649, 659, 670, 672, 674, 681, 682, 683, 684, 685, 688, 692, 694, 699, 701, 702, 710, 711, 714, 717, 719, 723, 729, 734,
  737, 742, 746, 747, 749, 750, 752, 754, 763, 768, 771, 773, 774, 775, 776, 784, 786, 794, 797, 798, 802, 809, 815, 825, 838, 844, 845, 847, 853,
  859, 860, 863, 874, 875, 879, 885, 888, 890, 895, 899, 901, 903, 905, 907, 909, 910, 915, 918, 920, 925, 927, 930, 933, 935, 937, 944, 955, 958,
  959, 963, 967, 970, 975, 976, 977, 985, 986, 989, 990,
];

const LAYOUT_ATTRIBUTES = ['sourceAdjacent', 'sourceNestedOpen', 'sourceNestedClose', 'sourceImageIndent', 'sourceIndentedCode'] as const;

/** Replay main's layout only on the named corpus pages with #625 differences. */
export function replayMainComponentLayout(editor: Editor): boolean {
  const transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    for (const attribute of LAYOUT_ATTRIBUTES) {
      if (node.attrs[attribute] !== undefined) transaction.setNodeAttribute(position, attribute, undefined);
    }
  });
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.setMeta('addToHistory', false));
  return true;
}

/** Match pre-#575 JSON where a Markdown node has no authored HTML metadata. */
export function withoutUnusedStructuredHtml(node: JSONContent, projectChild = withoutUnusedStructuredHtml): JSONContent {
  let projected = node;
  if (node.attrs && Object.hasOwn(node.attrs, 'sourceStructuredHtml') && node.attrs.sourceStructuredHtml === undefined) {
    const { attrs, ...rest } = node;
    const { sourceStructuredHtml: _empty, ...existing } = attrs;
    projected = Object.keys(existing).length === 0 ? rest : { ...node, attrs: existing };
  }
  return node.content ? { ...projected, content: node.content.map((child) => projectChild(child)) } : projected;
}
