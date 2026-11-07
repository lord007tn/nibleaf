// @vitest-environment jsdom
import {
  DOCUMENTATION_COMPONENTS,
  type DocumentationComponentAttribute,
  type DocumentationComponentDefinition,
} from '@nibleaf/shared/documentation-components';
import { portablePublicMdxMarkdown } from '@nibleaf/shared/public-markdown-content';
import { markdownTemplate, mdxIndexTemplate } from '@nibleaf/shared/theme-repository-templates';
import { Editor, type Node as TiptapNode } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { siteHref, siteLanguageParam } from '@/lib/site-paths';
import { mdxNodes } from './editor/extensions/mdx';
import { SUPPORTED_MDX_COMPONENTS } from './editor/extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './editor/tiptap-editor';
import { baseMdxComponents, type SiteLinkContext } from './markdown';
import RichMarkdown from './markdown-rich';
import { readerMdxComponents } from './site/mdx/component-map';
import { MDX_BLOCK_TAGS, sanitizeSchema } from './site/mdx-config';

/**
 * Every MDX component in the registry must be wired through each surface: an
 * editor node (or the callout extension) that saves every attribute, a reader
 * renderer that receives its content and props, sanitizer permission for its
 * attributes, a portable public-Markdown projection, and the exported theme
 * repository templates. A component that legitimately lacks one is listed
 * below with the reason.
 */
const KNOWN_GAPS = {
  portableMarkdown: {
    // The public machine representations keep `<Update>` as authored text
    // (normalizePublicMarkdownContent HTML-escapes it). Projecting it is a
    // separate, output-changing fix.
    Update: 'portablePublicMdxMarkdown has no Update projection yet',
  } as Readonly<Record<string, string>>,
  /** Sample props that render nothing by design. */
  hiddenAttributes: {
    // ParamField shows the first of path, query, header, body and name.
    ParamField: ['query', 'header', 'body', 'name'],
  } as Readonly<Record<string, readonly string[]>>,
};

type MdxComponent = DocumentationComponentDefinition & { tag: string; reader: NonNullable<DocumentationComponentDefinition['reader']> };
const MDX_COMPONENTS = DOCUMENTATION_COMPONENTS.filter((component): component is MdxComponent => component.syntax === 'mdx');
const byTag = new Map(MDX_COMPONENTS.map((component) => [component.tag, component]));
const READER_TAGS = MDX_COMPONENTS.map((component) => component.reader.tag);
const sorted = (values: Iterable<string>) => [...values].sort();
// A non-default language, so internal links visibly gain the site's language.
const SITE: SiteLinkContext = { projectId: 'p1', lang: 'ar', defaultLanguage: 'en' };

const sampleValue = (component: MdxComponent, attribute: DocumentationComponentAttribute): string | true => {
  switch (attribute.type) {
    case 'boolean':
      return true;
    case 'number':
      return '2';
    case 'enum':
      return attribute.values?.[0] ?? 'value';
    case 'url':
      return `/sample-${component.tag.toLowerCase()}`;
    case 'icon':
      return 'star';
    case 'color':
      return 'red';
    default:
      return `Sample-${component.tag}-${attribute.name}`;
  }
};
const portableAttributes = (component: MdxComponent) => component.attributes.filter((attribute) => !attribute.editorOnly);

interface Sample {
  markdown: string;
  /** Body text the sample places inside the component (or its nested child). */
  bodies: string[];
}

/** A valid authored usage with every portable attribute; containers hold a sample of their first allowed child. */
const sampleUsage = (component: MdxComponent): Sample => {
  const attributes = portableAttributes(component)
    .map((attribute) => {
      const value = sampleValue(component, attribute);
      return value === true ? ` ${attribute.name}` : ` ${attribute.name}="${value}"`;
    })
    .join('');
  if (component.selfClosing) return { markdown: `<${component.tag}${attributes} />`, bodies: [] };
  const body = `Body-${component.tag}`;
  if (component.kind === 'inline') return { markdown: `Before <${component.tag}${attributes}>${body}</${component.tag}> after.`, bodies: [body] };
  const childTag = component.allowedChildren?.find((tag) => tag !== component.tag);
  const child = childTag ? sampleUsage(byTag.get(childTag) as MdxComponent) : undefined;
  // A CodeGroup's panes are fenced code blocks; without one it renders nothing.
  const inner = child?.markdown ?? (component.tag === 'CodeGroup' ? `\`\`\`js title="${body}"\nconst x = 1;\n\`\`\`` : body);
  return { markdown: `<${component.tag}${attributes}>\n\n${inner}\n\n</${component.tag}>`, bodies: child?.bodies ?? [body] };
};

/** The sample inside its container when it is an item of one (a lone Tab never shows its title). */
const inContainer = (component: MdxComponent, sample: Sample): Sample => {
  const parent = MDX_COMPONENTS.find((candidate) => candidate !== component && candidate.allowedChildren?.includes(component.tag));
  return parent
    ? {
        ...sample,
        markdown: `<${parent.tag}>

${sample.markdown}

</${parent.tag}>`,
      }
    : sample;
};

type ParseRule = { tag?: string };
const parseRules = (node: TiptapNode): ParseRule[] => (node.config.parseHTML?.call(node as never) ?? []) as ParseRule[];
const attributeNames = (node: TiptapNode): string[] => Object.keys((node.config.addAttributes?.call(node as never) ?? {}) as Record<string, unknown>);
const calloutExtension = buildEditorExtensions().find((extension) => extension.name === 'callout') as TiptapNode;
const editorNodeFor = (component: MdxComponent) => {
  const wrapper = component.kind === 'inline' ? 'span' : 'div';
  return mdxNodes.find((node) => parseRules(node).some((rule) => rule.tag === `${wrapper}[data-mdx="${component.tag}"]`));
};
const renderRich = (content: string, site?: SiteLinkContext) => renderToStaticMarkup(createElement(RichMarkdown, { content, site }));

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** Save a freshly built node carrying a sample value for every registry attribute. */
const serializeWithEveryAttribute = (component: MdxComponent, node: TiptapNode) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  const attrs = Object.fromEntries(component.attributes.map((attribute) => [attribute.name, sampleValue(component, attribute)]));
  const type = editor.schema.nodes[node.name];
  const built = type?.createAndFill(attrs);
  if (!built) throw new Error(`cannot build ${node.name}`);
  const block = component.kind === 'inline' ? editor.schema.nodes.paragraph?.create(null, built) : built;
  editor.commands.setContent(editor.schema.nodes.doc?.create(null, block ?? []).toJSON() ?? '', { emitUpdate: false });
  return { markdown: getMarkdown(editor), attrs };
};

// Attribute names that could carry script, styles or a navigation the sanitizer
// does not protocol-check. The reader must never allow-list one.
const UNSAFE_ATTRIBUTE = /^(?:on.*|style|srcdoc|srcset|formaction|action|background|ping|dynsrc|lowsrc|poster|xlink:href|xmlns.*)$/i;

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

    // Callout variants are saved by the callout extension as GitHub admonitions
    // (`> [!WARNING]`); their only prop is the variant itself.
    it.skipIf(Boolean(component.reader.callout))('saves every registry attribute from the editor', () => {
      const { markdown, attrs } = serializeWithEveryAttribute(component, editorNodeFor(component) as TiptapNode);
      for (const [name, value] of Object.entries(attrs)) {
        if (value === true) expect(markdown, name).toMatch(new RegExp(`<${component.tag}\\b[^>]*\\s${name}(?=[\\s/>])`));
        else expect(markdown, name).toContain(`${name}="${value}"`);
      }
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

    it('declares no attribute that can carry script, styles or an unchecked URL', () => {
      for (const attribute of component.attributes) expect(attribute.name).not.toMatch(UNSAFE_ATTRIBUTE);
      for (const attribute of portableAttributes(component).filter((candidate) => candidate.type === 'url')) {
        // rehype-sanitize checks protocols per property name (href and src by default).
        expect(sanitizeSchema.protocols?.[attribute.name], `${attribute.name} is not protocol-checked`).toBeDefined();
        const html = renderRich(sampleUsage(component).markdown.replace(`${attribute.name}="`, `${attribute.name}="javascript:alert(1)//`));
        expect(html).not.toContain('javascript:');
      }
    });

    it('renders its content and props through the rich reader', () => {
      const sample = inContainer(component, sampleUsage(component));
      const html = renderRich(sample.markdown, SITE);
      expect(html).not.toMatch(new RegExp(`<\\/?${component.reader.tag}\\b`, 'i'));
      expect(html).not.toMatch(new RegExp(`&lt;\\/?${component.tag}\\b`, 'i'));
      for (const body of sample.bodies) expect(html, 'body').toContain(body);
      const hidden = KNOWN_GAPS.hiddenAttributes[component.tag] ?? [];
      for (const attribute of portableAttributes(component)) {
        const value = sampleValue(component, attribute);
        if (attribute.type === 'string' && !hidden.includes(attribute.name)) expect(html, attribute.name).toContain(String(value));
        if (attribute.type === 'url') {
          const rewritten = siteHref(SITE.projectId, String(value), { lang: siteLanguageParam(SITE.lang, SITE.defaultLanguage) });
          expect(rewritten).not.toBe(value);
          expect(html, attribute.name).toContain(`href="${rewritten}"`);
        }
        if (attribute.name === 'defaultOpen') {
          expect(html).toContain('aria-expanded="true"');
          expect(html).not.toContain('aria-expanded="false"');
        }
      }
    });

    it('leaves no raw tag in portable public Markdown', () => {
      const output = portablePublicMdxMarkdown(sampleUsage(component).markdown);
      const leaksTag = new RegExp(`<\\/?${component.tag}\\b`, 'i').test(output);
      // A listed gap must still be a gap, so the list cannot go stale.
      expect(leaksTag, KNOWN_GAPS.portableMarkdown[component.tag] ?? output).toBe(component.tag in KNOWN_GAPS.portableMarkdown);
    });
  });

  it('has no editor nodes or reader renderers for unregistered components', () => {
    const registered = new Set<string>(MDX_COMPONENTS.map((component) => component.tag));
    const editorTags = mdxNodes.flatMap((node) => parseRules(node).flatMap((rule) => /data-mdx="([^"]+)"/.exec(rule.tag ?? '')?.[1] ?? []));
    expect(editorTags.filter((tag) => !registered.has(tag))).toEqual([]);
    const readerTags = new Set(READER_TAGS);
    // `mermaid` is synthesized from fenced code, not authored as a tag.
    const renderers = Object.keys({ ...baseMdxComponents, ...readerMdxComponents(undefined) }).filter((tag) => tag !== 'mermaid');
    expect(renderers.filter((tag) => !readerTags.has(tag))).toEqual([]);
  });
});

/**
 * The exported GitHub theme repository ships its own copy of the reader
 * pipeline (`src/lib/markdown.tsx`, `src/components/mdx/index.tsx`). Its lists
 * are pinned byte-for-byte by the shared template tests, so they are checked
 * here instead: a registry component missing from the template fails this test
 * rather than being silently stripped in exported repositories.
 */
describe('exported theme repository templates', () => {
  const markdown = markdownTemplate();
  const index = mdxIndexTemplate();
  const between = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`template no longer contains ${start}`);
    return source.slice(from + start.length, to);
  };
  const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
  const component = (predicate: (candidate: MdxComponent) => boolean) => MDX_COMPONENTS.filter(predicate);

  it('allows every registry component tag', () => {
    expect(sorted(quoted(between(markdown, 'const componentTags = [', '];')))).toEqual(sorted(READER_TAGS));
  });

  it('allows the same component attributes as the reader', () => {
    const block = between(markdown, '...defaultSchema.attributes,\n', '\n  },\n};');
    const template = Object.fromEntries(
      [...block.matchAll(/^\s+(\w+): \[(.*)\],$/gm)].map((match) => [match[1] as string, sorted(quoted(match[2] as string))]),
    );
    const reader = Object.fromEntries(
      READER_TAGS.flatMap((tag) => {
        const allowed = sanitizeSchema.attributes?.[tag] as string[] | undefined;
        return allowed ? [[tag, sorted(allowed)]] : [];
      }),
    );
    // Includes `dataDisplayName` (not `name`) wherever the reader moves a
    // display name; theme-template-markdown.test.tsx renders that end to end.
    expect(template).toEqual(reader);
  });

  it('treats the same tags as Markdown-bodied blocks', () => {
    expect(sorted(between(markdown, "const blockTags =\n  '", "';").split('|'))).toEqual(sorted(MDX_BLOCK_TAGS));
  });

  it('renames and expands the same tags as the reader', () => {
    const renames = [...markdown.matchAll(/\.replace\(\/<\(\\\/\?\)(\w+)\\b\/gi, '<\$1(\w+)'\)/g)].map((match) => [match[1], match[2]]);
    expect(renames).toEqual(
      component((candidate) => candidate.reader.tag !== candidate.tag.toLowerCase()).map((candidate) => [candidate.tag, candidate.reader.tag]),
    );
    const selfClosing = /\.replace\(\/<\(([\w|]+)\)\\b\(\[\^>\]\*\)\\\/>\/gi/.exec(markdown)?.[1]?.split('|');
    expect(sorted(selfClosing ?? [])).toEqual(sorted(component((candidate) => candidate.selfClosing).map((candidate) => candidate.tag)));
  });

  it('moves display names and unwraps structural items for the same tags', () => {
    expect(sorted(quoted(between(markdown, 'const authoredNameTags = new Set([', '])')))).toEqual(
      sorted(component((candidate) => candidate.reader.displayName).map((candidate) => candidate.reader.tag)),
    );
    expect(sorted(quoted(between(markdown, 'const structuralTags = new Set([', '])')))).toEqual(
      sorted(component((candidate) => candidate.reader.structural).map((candidate) => candidate.reader.tag)),
    );
  });

  it('renders every registry component tag', () => {
    expect(sorted([...quoted(between(index, 'type DocumentationTag =', ';')), 'button'])).toEqual(sorted(READER_TAGS));
    const keys = [...between(index, 'export const mdxComponents: DocumentationComponents = {', '\n};').matchAll(/^ {2}(\w+):/gm)].map(
      (match) => match[1] as string,
    );
    expect(sorted(keys)).toEqual(sorted(READER_TAGS));
  });
});
