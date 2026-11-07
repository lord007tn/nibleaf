import type { MessageKey } from '@nibleaf/i18n';
import { DOCUMENTATION_COMPONENTS, type DocumentationComponentAttribute } from '@nibleaf/shared/documentation-components';
import type { Node as PMNode } from '@tiptap/pm/model';
import { type EditorState, NodeSelection } from '@tiptap/pm/state';

/**
 * What the component settings panel shows for each editor node, derived from
 * the documentation component registry: one field per registry attribute, with
 * a friendly label, a one-line hint and localized option labels.
 */

/** Title-bearing blocks edit this attribute in place (see TitledBlockView), so the panel leaves it out. */
const INLINE_ATTRIBUTE: Readonly<Record<string, string>> = {
  mdxStep: 'title',
  mdxCard: 'title',
  mdxTab: 'title',
  mdxAccordion: 'title',
  mdxFrame: 'caption',
  mdxExpandable: 'title',
  mdxFolder: 'name',
  mdxFile: 'name',
  mdxApiExample: 'title',
  mdxRequestExample: 'title',
  mdxResponseExample: 'title',
  mdxRelatedContent: 'title',
  mdxRelatedCard: 'title',
};

export const inlineAttributeOf = (nodeName: string): string | undefined => INLINE_ATTRIBUTE[nodeName];

type Copy = { label: MessageKey; hint?: MessageKey };
const copy = (name: string, hasHint = true): Copy =>
  ({
    label: `editor.componentSettings.attr.${name}.label`,
    ...(hasHint ? { hint: `editor.componentSettings.attr.${name}.hint` } : {}),
  }) as Copy;

const ATTRIBUTE_COPY: Readonly<Record<string, Copy>> = Object.fromEntries(
  [
    'title',
    'hint',
    'name',
    'icon',
    'href',
    'description',
    'color',
    'horizontal',
    'img',
    'cta',
    'arrow',
    'cols',
    'defaultTabIndex',
    'sync',
    'borderBottom',
    'id',
    'defaultOpen',
    'titleSize',
    'stepNumber',
    'headline',
    'tip',
    'size',
    'shape',
    'stroke',
    'disabled',
    'type',
    'variant',
    'dismissible',
    'label',
    'tags',
    'status',
    'required',
    'deprecated',
    'default',
    'placeholder',
    'pre',
    'post',
  ].map((name) => [name, copy(name)]),
);

/** Wording that depends on the component (`color` tints a callout but colors a card's icon). */
const COMPONENT_COPY: Readonly<Record<string, Copy>> = {
  'Callout.color': copy('calloutColor'),
  'Card.color': copy('iconColor'),
  'Icon.color': copy('iconColor'),
  'Icon.size': { label: 'editor.componentSettings.attr.iconSize.label', hint: 'editor.componentSettings.attr.size.hint' },
  'Columns.cols': { label: 'editor.componentSettings.attr.cols.label', hint: 'editor.componentSettings.attr.columnsCols.hint' },
  'Tooltip.cta': { label: 'editor.componentSettings.attr.cta.label', hint: 'editor.componentSettings.attr.tooltipCta.hint' },
  'ParamField.type': copy('dataType'),
  'ResponseField.type': copy('dataType'),
  'ResponseField.name': copy('fieldName'),
};

/** Attributes edited by a dedicated field (or aliases the panel does not offer). */
const HIDDEN: ReadonlySet<string> = new Set([
  // `name` is an alias of `icon`; the panel writes `icon`.
  'Icon.name',
  // One "Sent in" + name field replaces the five mutually exclusive location props.
  'ParamField.path',
  'ParamField.query',
  'ParamField.header',
  'ParamField.body',
  'ParamField.name',
  // The callout type is the editor's variant (it may rename the tag).
  'Callout.type',
]);

const CALLOUT_TYPE_LABELS: Readonly<Record<string, MessageKey>> = {
  note: 'editor.slash.note.title',
  tip: 'editor.slash.tip.title',
  info: 'editor.slash.info.title',
  check: 'editor.slash.check.title',
  warning: 'editor.slash.warning.title',
  danger: 'editor.slash.danger.title',
};

const camel = (value: string): string => value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/** Localized label for one enum (or named color) value. */
export function optionLabel(tag: string, attribute: string, value: string): MessageKey | undefined {
  if ((tag === 'Callout' || tag === 'Banner') && attribute === 'type') return CALLOUT_TYPE_LABELS[value];
  if (attribute === 'titleSize' || attribute === 'size' || attribute === 'shape' || attribute === 'variant') {
    return `editor.componentSettings.option.${attribute}.${value}` as MessageKey;
  }
  if (attribute === 'color') return `editor.componentSettings.option.color.${camel(value)}` as MessageKey;
  return undefined;
}

export type SettingsField =
  | { kind: 'attribute'; attribute: DocumentationComponentAttribute; copy: Copy; oneBased?: boolean }
  | { kind: 'paramLocation' }
  | { kind: 'calloutType' };

export interface ComponentSettingsSchema {
  tag: string;
  nodeName: string;
  fields: SettingsField[];
}

const COMPONENT_NAMES: Readonly<Record<string, MessageKey>> = {
  Callout: 'editor.slash.callout.title',
  Steps: 'editor.slash.steps.title',
  Step: 'editor.componentSettings.component.step',
  CardGroup: 'editor.slash.cardGroup.title',
  Card: 'editor.slash.card.title',
  Tabs: 'editor.slash.tabs.title',
  Tab: 'editor.componentSettings.component.tab',
  AccordionGroup: 'editor.componentSettings.component.accordionGroup',
  Accordion: 'editor.slash.accordion.title',
  Frame: 'editor.slash.frame.title',
  Expandable: 'editor.slash.expandable.title',
  Update: 'editor.slash.update.title',
  ParamField: 'editor.slash.paramField.title',
  ResponseField: 'editor.slash.responseField.title',
  Columns: 'editor.componentSettings.component.columns',
  Column: 'editor.componentSettings.component.column',
  Banner: 'editor.slash.banner.title',
  Badge: 'editor.slash.badge.title',
  Button: 'editor.slash.button.title',
  Tooltip: 'editor.slash.tooltip.title',
  Icon: 'editor.slash.icon.title',
  FileTree: 'editor.slash.fileTree.title',
  Folder: 'editor.slash.folder.title',
  File: 'editor.slash.file.title',
  ApiExample: 'editor.slash.apiExample.title',
  RequestExample: 'editor.slash.requestExample.title',
  ResponseExample: 'editor.slash.responseExample.title',
  RelatedContent: 'editor.slash.relatedContent.title',
  RelatedCard: 'editor.slash.relatedCard.title',
};

/** The localized name of a component, for the panel title and the gear's label. */
export const componentNameKey = (tag: string): MessageKey | undefined => COMPONENT_NAMES[tag];

const REGISTRY = new Map(DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag ? [[component.tag, component] as const] : [])));

/** `mdxCard` → `Card`; the callout extension is the generic `<Callout>`. */
export const componentTagOf = (nodeName: string): string | undefined => {
  const tag = nodeName === 'callout' ? 'Callout' : nodeName.startsWith('mdx') ? nodeName.slice(3) : undefined;
  return tag && REGISTRY.has(tag as never) ? tag : undefined;
};

const schemaCache = new Map<string, ComponentSettingsSchema | null>();

/** The panel's fields for a node type, or null when it has nothing to set. */
export function settingsSchemaFor(nodeName: string): ComponentSettingsSchema | null {
  const cached = schemaCache.get(nodeName);
  if (cached !== undefined) return cached;
  const tag = componentTagOf(nodeName);
  const component = tag ? REGISTRY.get(tag as never) : undefined;
  let schema: ComponentSettingsSchema | null = null;
  if (tag && component) {
    const inline = inlineAttributeOf(nodeName);
    const fields: SettingsField[] = [];
    if (tag === 'Callout') fields.push({ kind: 'calloutType' });
    if (tag === 'ParamField') fields.push({ kind: 'paramLocation' });
    for (const attribute of component.attributes) {
      if (attribute.name === inline || HIDDEN.has(`${tag}.${attribute.name}`)) continue;
      const fieldCopy = COMPONENT_COPY[`${tag}.${attribute.name}`] ?? ATTRIBUTE_COPY[attribute.name] ?? copy('title');
      fields.push({ kind: 'attribute', attribute, copy: fieldCopy, ...(attribute.name === 'defaultTabIndex' ? { oneBased: true } : {}) });
    }
    schema = fields.length > 0 ? { tag, nodeName, fields } : null;
  }
  schemaCache.set(nodeName, schema);
  return schema;
}

/** A component node the panel can edit, located in the document. */
export interface SettingsTarget {
  pos: number;
  nodeName: string;
  tag: string;
}

const targetFor = (node: PMNode, pos: number): SettingsTarget | null => {
  const schema = settingsSchemaFor(node.type.name);
  return schema ? { pos, nodeName: node.type.name, tag: schema.tag } : null;
};

/** Components around `pos`, innermost first (a selected component node included). */
export function componentTargetsAt(state: EditorState, pos: number): SettingsTarget[] {
  const targets: SettingsTarget[] = [];
  const atom = state.doc.nodeAt(pos);
  if (atom?.isAtom) {
    const target = targetFor(atom, pos);
    if (target) targets.push(target);
  }
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const target = targetFor($pos.node(depth), $pos.before(depth));
    if (target) targets.push(target);
  }
  return targets;
}

/** The innermost component holding the selection (or the selected component node). */
export function activeComponentTarget(state: EditorState): SettingsTarget | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const target = targetFor(selection.node, selection.from);
    if (target) return target;
  }
  return componentTargetsAt(state, selection.from)[0] ?? null;
}

export const sameTarget = (left: SettingsTarget | null, right: SettingsTarget | null): boolean =>
  left === right || (left !== null && right !== null && left.pos === right.pos && left.nodeName === right.nodeName);

/** The target's node, when it is still in the document where it was. */
export const targetNode = (state: EditorState, target: SettingsTarget): PMNode | null => {
  if (target.pos < 0 || target.pos >= state.doc.content.size) return null;
  const node = state.doc.nodeAt(target.pos);
  return node?.type.name === target.nodeName ? node : null;
};
