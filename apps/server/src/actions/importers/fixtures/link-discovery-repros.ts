export const linkDiscoveryRepros: Array<{ name: string; content: string }> = [
  {
    name: 'round 1: group must not overwrite source document',
    content: '[Original document](/getting-started)',
  },
  {
    name: 'round 1: existing non-imported site page',
    content: '[Existing site onboarding](/getting-started)',
  },
  {
    name: 'round 1: image reference definition',
    content: '![Existing screenshot][shot]\n\n[shot]: /getting-started "Screenshot"',
  },
  {
    name: 'round 1: shared image/link reference definition',
    content: '![Screenshot][shot]\n\n[Shared][shot]\n\n[shot]: /getting-started "Screenshot"',
  },
  {
    name: 'round 3: invalid definition with trailing text',
    content: '[x]: /topic/next extra text\n\n[Real](/topic/next)',
  },
  {
    name: 'round 3: valid reference definition remains deferred',
    content: '[Go][r]\n\n[r]: /topic/next "Title"',
  },
  {
    name: 'round 4: compact Steps and Step',
    content: '<Steps><Step>[Go](/next)</Step></Steps>',
  },
  {
    name: 'round 5: Note and lowercase div',
    content: '<Note>\n<div>\n[Go](/next?x=1#part)\n</div>\n</Note>',
  },
  {
    name: 'round 5: foreign query language unresolved',
    content: '[Arabic](https://help.test/custom/hidden?lang=ar)',
  },
  {
    name: 'round 5: foreign frontmatter language unresolved',
    content: '[Arabic](https://help.test/custom/hidden)',
  },
  {
    name: 'round 6: footnote definition child',
    content: '[^f]\n\n[^f]: [Go](/next?x=1#part)',
  },
  {
    name: 'round 6: Markdown-shaped attribute and child',
    content: '<Note>\n<div title="[Example](/next)">\n[Go](/next?x=1#part)\n</div>\n</Note>',
  },
  {
    name: 'round 6: stray code closing tag',
    content: '</code>\n\n[Go](/next?x=1#part)',
  },
  {
    name: 'round 6: stray pre closing tag',
    content: '</pre>\n\n[Go](/next?x=1#part)',
  },
  {
    name: 'round 5: origin escape source double slash',
    content: '[Next](https://help.test//evil.test/next)',
  },
  {
    name: 'round 5: origin escape source backslash',
    content: '[Next](https://help.test/\\evil.test/next)',
  },
  {
    name: 'round 5: origin escape application double slash',
    content: '[Next](https://nibleaf.com/pages//evil.test/next)',
  },
  {
    name: 'round 5: origin escape application backslash',
    content: '[Next](https://nibleaf.com/pages/\\evil.test/next)',
  },
  {
    name: 'round 5: origin escape root backslash',
    content: '[Next](/\\evil.test)',
  },
];
