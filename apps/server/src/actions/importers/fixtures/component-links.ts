export const componentLinkFixtures: Array<{ name: string; content: string }> = [];
const componentRepro = '<Steps>\n<Step title="One">\n[Go](/next)\n</Step>\n</Steps>\n\n[Real](/next)';
componentLinkFixtures.push({ name: 'no-collision Steps repro', content: componentRepro });
for (const [name, open, close] of [
  ['Steps/Step', '<Steps>\n<Step title="One">', '</Step>\n</Steps>'],
  ['Tabs/Tab', '<Tabs>\n<Tab title="One">', '</Tab>\n</Tabs>'],
  ['Accordion', '<Accordion title="Details">', '</Accordion>'],
  ['Note', '<Note>', '</Note>'],
  ['Tip', '<Tip>', '</Tip>'],
  ['Warning', '<Warning>', '</Warning>'],
  ['CardGroup', '<CardGroup>', '</CardGroup>'],
  ['Columns', '<Columns>', '</Columns>'],
  ['nested', '<Columns>\n<Card href="/next">\n<Note>', '</Note>\n</Card>\n</Columns>'],
  ['unknown', '<Unknown.Widget>', '</Unknown.Widget>'],
  ['unclosed', '<Columns>', ''],
  ['malformed opener', '<Columns broken="', '</Columns>'],
] as const) {
  for (const blank of [false, true]) {
    const gap = blank ? '\n\n' : '\n';
    componentLinkFixtures.push({ name: `${name}, blank=${blank}`, content: `${componentRepro}\n\n${open}${gap}[Child](/next)${gap}${close}` });
  }
}
componentLinkFixtures.push({ name: 'indented children', content: `${componentRepro}\n\n<Steps>\n  <Step>\n    [Child](/next)\n  </Step>\n</Steps>` });
componentLinkFixtures.push({
  name: 'fenced children',
  content: `${componentRepro}\n\n<Columns>\n~~~md\n[Literal](/next)\n~~~\n[Child](/next)\n</Columns>`,
});
componentLinkFixtures.push({
  name: 'reference definition',
  content: `${componentRepro}\n\n<Note>\n[inside]: /topic/next "Title"\n[Reference][inside]\n</Note>`,
});
