import { describe, expect, it } from 'vitest';
import { SUPPORTED_MDX_COMPONENTS, type SupportedDefinition } from './extensions/mdx-roundtrip';

// The editor's MDX inventory as it was hand-written before being derived from the
// component registry. A registry change that alters it is a deliberate editor
// change: update the literal in the same commit.
const EXPECTED: Readonly<Record<string, SupportedDefinition>> = {
  steps: { canonical: 'Steps', attrs: [] },
  step: { canonical: 'Step', attrs: ['title'], defaults: { title: '' } },
  cardgroup: { canonical: 'CardGroup', attrs: ['cols'], defaults: { cols: '2' } },
  card: { canonical: 'Card', attrs: ['title', 'icon', 'href'], defaults: { title: '', icon: '', href: '' } },
  tabs: { canonical: 'Tabs', attrs: [] },
  tab: { canonical: 'Tab', attrs: ['title'], defaults: { title: '' } },
  accordiongroup: { canonical: 'AccordionGroup', attrs: [] },
  accordion: { canonical: 'Accordion', attrs: ['title', 'defaultOpen'], defaults: { title: '', defaultOpen: false } },
  frame: { canonical: 'Frame', attrs: ['caption'], defaults: { caption: '' } },
  expandable: { canonical: 'Expandable', attrs: ['title', 'defaultOpen'], defaults: { title: '', defaultOpen: false } },
  update: { canonical: 'Update', attrs: ['label', 'description'], defaults: { label: '', description: '' } },
  filetree: { canonical: 'FileTree', attrs: [] },
  folder: { canonical: 'Folder', attrs: ['name', 'defaultOpen'], defaults: { name: '', defaultOpen: false } },
  file: { canonical: 'File', attrs: ['name', 'icon'], defaults: { name: '', icon: '' } },
  apiexample: { canonical: 'ApiExample', attrs: ['title'], defaults: { title: '' } },
  requestexample: { canonical: 'RequestExample', attrs: ['title'], defaults: { title: '' } },
  responseexample: { canonical: 'ResponseExample', attrs: ['title', 'status'], defaults: { title: '', status: '' } },
  relatedcontent: { canonical: 'RelatedContent', attrs: ['title'], defaults: { title: '' } },
  relatedcard: {
    canonical: 'RelatedCard',
    attrs: ['title', 'description', 'href', 'icon'],
    defaults: { title: '', description: '', href: '', icon: '' },
  },
  paramfield: { canonical: 'ParamField', attrs: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'] },
  responsefield: { canonical: 'ResponseField', attrs: ['name', 'type', 'required', 'default', 'deprecated'] },
  codegroup: { canonical: 'CodeGroup', attrs: [] },
  columns: { canonical: 'Columns', attrs: [] },
  column: { canonical: 'Column', attrs: [] },
  banner: { canonical: 'Banner', attrs: ['type', 'dismissible'] },
  badge: { canonical: 'Badge', attrs: ['color'], defaults: { color: '' }, inline: true },
  button: { canonical: 'Button', attrs: ['href', 'variant'], defaults: { href: '', variant: '' }, inline: true },
  tooltip: { canonical: 'Tooltip', attrs: ['tip'], defaults: { tip: '' }, inline: true },
  icon: { canonical: 'Icon', attrs: ['icon', 'name', 'color', 'size'], defaults: { icon: '', name: '', color: '', size: '' }, inline: true },
  callout: { canonical: 'Callout', attrs: ['type'], calloutVariant: 'note' },
  note: { canonical: 'Note', attrs: [], calloutVariant: 'note' },
  tip: { canonical: 'Tip', attrs: [], calloutVariant: 'tip' },
  check: { canonical: 'Check', attrs: [], calloutVariant: 'check' },
  warning: { canonical: 'Warning', attrs: [], calloutVariant: 'warning' },
  danger: { canonical: 'Danger', attrs: [], calloutVariant: 'danger' },
  info: { canonical: 'Info', attrs: [], calloutVariant: 'info' },
};

/** What the round-trip actually reads: a missing default is the empty string
 *  (`effectiveAttributes`) and a missing `inline` is false. */
const behaviour = (definition: SupportedDefinition) => ({
  canonical: definition.canonical,
  attrs: definition.attrs,
  defaults: Object.fromEntries(definition.attrs.map((name) => [name, definition.defaults?.[name] ?? ''])),
  inline: definition.inline === true,
  calloutVariant: definition.calloutVariant,
});

describe('editor MDX inventory', () => {
  it('supports the same tags, attributes, defaults and wrappers as before', () => {
    expect(Object.keys(SUPPORTED_MDX_COMPONENTS).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [tag, definition] of Object.entries(EXPECTED)) {
      expect(behaviour(SUPPORTED_MDX_COMPONENTS[tag] as SupportedDefinition), tag).toEqual(behaviour(definition));
    }
  });
});
