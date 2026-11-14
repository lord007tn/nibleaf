export const extendedImportWrappers: ReadonlyArray<readonly [string, string]> = [
  ['<span>\n', '\n</span>'],
  ['<details>\n', '\n</details>'],
  ['<table>\n', '\n</table>'],
  ['<dIv title="Example">\n', '\n</dIv>'],
  ['<Note>\n<details data-test="x">\n', '\n</details>\n</Note>'],
  ['<Note>\n<table>\n', '\n</table>\n</Note>'],
  ['<Note>\n<span>\n', '\n</span>\n</Note>'],
  ['<Note>\n<details>\n', ''],
  ['<!-- comment -->\n<Note>\n', '\n</Note>'],
  ['<Note>\n<div title="[Example](/next)">\n', '\n</div>\n</Note>'],
  ['</code>\n\n', ''],
];
