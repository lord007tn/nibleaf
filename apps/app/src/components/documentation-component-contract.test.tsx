// @vitest-environment jsdom
import {
  DOCUMENTATION_COMPONENTS,
  type DocumentationComponentAttribute,
  type DocumentationComponentDefinition,
} from '@nibleaf/shared/documentation-components';
import { portablePublicMdxMarkdown } from '@nibleaf/shared/public-markdown-content';
import type { Node as TiptapNode } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mdxNodes } from './editor/extensions/mdx';
import { SUPPORTED_MDX_COMPONENTS } from './editor/extensions/mdx-roundtrip';
import { buildEditorExtensions } from './editor/tiptap-editor';
import { baseMdxComponents } from './markdown';
import RichMarkdown from './markdown-rich';
import { readerMdxComponents } from './site/mdx/component-map';
import { sanitizeSchema } from './site/mdx-config';

/**
 * Every MDX component in the registry must be wired through each surface: an
 * editor node (or the callout extension), a reader renderer, sanitizer
 * permission for its attributes, and a portable public-Markdown projection.
 * A component that legitimately lacks one is listed below with the reason.
 */
const KNOWN_GAPS: { portableMarkdown: Readonly<Record<string, string>> } = {
  portableMarkdown: {},
};

type MdxComponent = DocumentationComponentDefinition & { tag: string; reader: NonNullable<DocumentationComponentDefinition['reader']> };
const MDX_COMPONENTS = DOCUMENTATION_COMPONENTS.filter((component): component is MdxComponent => component.syntax === 'mdx');

const sampleValue = (attribute: DocumentationComponentAttribute): string | true => {
  switch (attribute.type) {
    case 'boolean':
      return true;
    case 'number':
      return '2';
    case 'enum':
      return attribute.values?.[0] ?? 'value';
    case 'url':
      return '/sample';
    case 'icon':
      return 'star';
    case 'color':
      return 'red';
    default:
      return `Sample ${attribute.name}`;
  }
};

/** A representative authored usage of one component, with every portable attribute. */
const sampleUsage = (component: MdxComponent): string => {
  const attributes = component.attributes
    .filter((attribute) => !attribute.editorOnly)
    .map((attribute) => {
      // Lists are authored as Mintlify writes them: a literal JSX array.
      if (attribute.type === 'list') return ` ${attribute.name}={["Sample"]}`;
      const value = sampleValue(attribute);
      return value === true ? ` ${attribute.name}` : ` ${attribute.name}="${value}"`;
    })
    .join('');
  if (component.selfClosing) return `<${component.tag}${attributes} />`;
  if (component.kind === 'inline') return `Before <${component.tag}${attributes}>inline body</${component.tag}> after.`;
  return `<${component.tag}${attributes}>\n\nBlock body.\n\n</${component.tag}>`;
};

type ParseRule = { tag?: string };
const parseRules = (node: TiptapNode): ParseRule[] => (node.config.parseHTML?.call(node as never) ?? []) as ParseRule[];
const attributeNames = (node: TiptapNode): string[] => Object.keys((node.config.addAttributes?.call(node as never) ?? {}) as Record<string, unknown>);
const calloutExtension = buildEditorExtensions().find((extension) => extension.name === 'callout') as TiptapNode;
const editorNodeFor = (component: MdxComponent) => {
  const wrapper = component.kind === 'inline' ? 'span' : 'div';
  return mdxNodes.find((node) => parseRules(node).some((rule) => rule.tag === `${wrapper}[data-mdx="${component.tag}"]`));
};

describe('documentation component contract', () => {
  it('covers MDX components', () => {
    expect(MDX_COMPONENTS.length).toBeGreaterThan(30);
  });

  describe.each(MDX_COMPONENTS.map((component) => [component.tag, component] as const))('%s', (_tag, component) => {
    it('has an editor node or is a callout variant handled by the callout extension', () => {
      expect(SUPPORTED_MDX_COMPONENTS[component.tag.toLowerCase()]?.canonical).toBe(component.tag);
      if (component.reader.callout) {
        expect(SUPPORTED_MDX_COMPONENTS[component.tag.toLowerCase()]?.calloutVariant).toBe(component.reader.callout);
        expect(parseRules(calloutExtension).map((rule) => rule.tag)).toContain(component.reader.callout);
        return;
      }
      const node = editorNodeFor(component);
      expect(node, `no editor node parses data-mdx="${component.tag}"`).toBeDefined();
      expect(attributeNames(node as TiptapNode)).toEqual(expect.arrayContaining(component.attributes.map((attribute) => attribute.name)));
    });

    it('has a reader renderer', () => {
      const renderers = { ...baseMdxComponents, ...readerMdxComponents(undefined) };
      expect(Object.keys(renderers)).toContain(component.reader.tag);
    });

    it('is allowed by the sanitizer with every portable attribute', () => {
      expect(sanitizeSchema.tagNames).toContain(component.reader.tag);
      const allowed = (sanitizeSchema.attributes?.[component.reader.tag] ?? []) as string[];
      for (const attribute of component.attributes) {
        const spelling = attribute.name === 'name' ? 'dataDisplayName' : attribute.name;
        if (attribute.editorOnly) {
          expect(allowed, `${attribute.name} is editor-only`).not.toContain(spelling);
          continue;
        }
        expect(allowed).toContain(spelling);
        if (spelling !== spelling.toLowerCase() && attribute.name !== 'name') expect(allowed).toContain(spelling.toLowerCase());
      }
    });

    it('renders through the rich reader without leaking the raw element', () => {
      const html = renderToStaticMarkup(createElement(RichMarkdown, { content: sampleUsage(component) }));
      expect(html).not.toMatch(new RegExp(`<\\/?${component.reader.tag}\\b`, 'i'));
      expect(html).not.toMatch(new RegExp(`&lt;\\/?${component.tag}\\b`, 'i'));
    });

    it('leaves no raw tag in portable public Markdown', () => {
      const output = portablePublicMdxMarkdown(sampleUsage(component));
      const leaksTag = new RegExp(`<\\/?${component.tag}\\b`, 'i').test(output);
      // A listed gap must still be a gap, so the list cannot go stale.
      expect(leaksTag, KNOWN_GAPS.portableMarkdown[component.tag] ?? output).toBe(component.tag in KNOWN_GAPS.portableMarkdown);
    });
  });

  it('has no editor nodes or reader renderers for unregistered components', () => {
    const registered = new Set<string>(MDX_COMPONENTS.map((component) => component.tag));
    const editorTags = mdxNodes.flatMap((node) => parseRules(node).flatMap((rule) => /data-mdx="([^"]+)"/.exec(rule.tag ?? '')?.[1] ?? []));
    expect(editorTags.filter((tag) => !registered.has(tag))).toEqual([]);
    const readerTags = new Set(MDX_COMPONENTS.map((component) => component.reader.tag));
    // `mermaid` is synthesized from fenced code, not authored as a tag.
    const renderers = Object.keys({ ...baseMdxComponents, ...readerMdxComponents(undefined) }).filter((tag) => tag !== 'mermaid');
    expect(renderers.filter((tag) => !readerTags.has(tag))).toEqual([]);
  });
});
