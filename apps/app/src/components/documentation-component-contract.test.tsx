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
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
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
  /** Props that intentionally change nothing in the sample render, with the reason.
   *  The wiring test fails both for an unlisted inert prop and for a listed one
   *  that does render, so this list cannot go stale. */
  hiddenAttributes: {
    ParamField: {
      query: 'ParamField shows the first of path, query, header, body and name; the sample sets path',
      header: 'ParamField shows the first of path, query, header, body and name; the sample sets path',
      body: 'ParamField shows the first of path, query, header, body and name; the sample sets path',
      name: 'ParamField shows the first of path, query, header, body and name; the sample sets path',
    },
    Icon: { name: '`name` is the fallback for `icon`, which the sample sets' },
  } as Readonly<Record<string, Readonly<Record<string, string>>>>,
  /** URL- or icon-typed props the sanitizer does not protocol-check, with the reason. */
  unprotocolledAttributes: {
    'Icon.name':
      'travels as `dataDisplayName`, which is shared with display-only File/Folder/field names that may contain colons; the Icon renderer only resolves it as an icon name',
  } as Readonly<Record<string, string>>,
};

type MdxComponent = DocumentationComponentDefinition & { tag: string; reader: NonNullable<DocumentationComponentDefinition['reader']> };
const MDX_COMPONENTS = DOCUMENTATION_COMPONENTS.filter((component): component is MdxComponent => component.syntax === 'mdx');
const byTag = new Map(MDX_COMPONENTS.map((component) => [component.tag, component]));
const READER_TAGS = MDX_COMPONENTS.map((component) => component.reader.tag);
const sorted = (values: Iterable<string>) => [...values].sort();
// A non-default language, so internal links visibly gain the site's language.
const SITE: SiteLinkContext = { projectId: 'p1', lang: 'ar', defaultLanguage: 'en' };

/** A real, non-default sample value, so a prop that is not wired through to
 *  the renderer leaves the HTML unchanged and fails the wiring test. */
const sampleValue = (component: MdxComponent, attribute: DocumentationComponentAttribute): string | true => {
  switch (attribute.type) {
    case 'boolean':
      return true;
    case 'number':
      // CardGroup `cols`: not the default (2) and not the first choice (1), so 3.
      return attribute.values?.find((value) => value !== String(attribute.default ?? '') && value !== attribute.values?.[0]) ?? '24';
    case 'enum':
      // The first choice is the default (`info` for Banner, `note` for Callout, `default` for Button).
      return attribute.values?.at(-1) ?? 'value';
    case 'url':
      return `/sample-${component.tag.toLowerCase()}`;
    case 'icon':
      return attribute.name === 'icon' ? 'rocket' : 'book-open';
    case 'color':
      return '#0ea5e9';
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

/** A valid authored usage with every portable attribute (but `omit`); containers hold a sample of their first allowed child. */
const sampleUsage = (component: MdxComponent, omit?: string): Sample => {
  const attributes = portableAttributes(component)
    .filter((attribute) => attribute.name !== omit)
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

    it.skipIf(Boolean(component.reader.callout))('defaults and parses each editor attribute the way the registry says', () => {
      type Spec = { default: unknown; parseHTML?: (element: HTMLElement) => unknown };
      const specs = ((editorNodeFor(component) as TiptapNode).config.addAttributes?.call(editorNodeFor(component) as never) ?? {}) as Record<
        string,
        Spec
      >;
      const supported = SUPPORTED_MDX_COMPONENTS[component.tag.toLowerCase()];
      for (const attribute of component.attributes) {
        const spec = specs[attribute.name] as Spec;
        // The round-trip compares edits against the registry default, so the node must start from it.
        expect(spec.default, `${attribute.name} default`).toEqual(supported?.defaults?.[attribute.name] ?? '');
        if (attribute.type !== 'boolean') continue;
        const bare = document.createElement('div');
        bare.setAttribute(attribute.name, '');
        expect(spec.parseHTML?.(bare), `${attribute.name} present`).toBe(true);
        // A switch is off when absent; a presence flag is simply absent (and written back bare when present).
        expect(spec.parseHTML?.(document.createElement('div')), `${attribute.name} absent`).toBe(attribute.presence ? '' : false);
      }
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
      // URLs, and icons (which a future renderer may resolve as image URLs), must
      // have their scheme checked. rehype-sanitize does that per property name.
      for (const attribute of portableAttributes(component).filter((candidate) => candidate.type === 'url' || candidate.type === 'icon')) {
        const property = attribute.name === 'name' ? 'dataDisplayName' : attribute.name;
        if (`${component.tag}.${attribute.name}` in KNOWN_GAPS.unprotocolledAttributes) {
          expect(sanitizeSchema.protocols?.[property], `${attribute.name} is listed as unchecked`).toBeUndefined();
          continue;
        }
        expect(sanitizeSchema.protocols?.[property], `${attribute.name} is not protocol-checked`).toBeDefined();
        const tree = {
          type: 'root',
          children: [{ type: 'element', tagName: component.reader.tag, properties: { [property]: 'javascript:alert(1)' }, children: [] }],
        };
        const sanitized = rehypeSanitize(sanitizeSchema)(tree as never) as unknown as typeof tree;
        expect(sanitized.children[0]?.properties[property], `${attribute.name} kept a javascript: URL`).toBeUndefined();
        if (attribute.type === 'url') {
          const html = renderRich(sampleUsage(component).markdown.replace(`${attribute.name}="`, `${attribute.name}="javascript:alert(1)//`));
          expect(html).not.toContain('javascript:');
        }
      }
    });

    const colorAttributes = portableAttributes(component).filter((candidate) => candidate.type === 'color');
    // Only components with a color prop get this case: for the rest it would assert nothing.
    if (colorAttributes.length > 0)
      it('lets only a plain color value reach an inline style', () => {
        for (const attribute of colorAttributes) {
          const sample = inContainer(component, sampleUsage(component)).markdown;
          const hostile = sample.replace(`${attribute.name}="#0ea5e9"`, `${attribute.name}="red;position:fixed;inset:0"`);
          expect(hostile, `${attribute.name} sample`).not.toBe(sample);
          expect(renderRich(hostile, SITE), attribute.name).not.toMatch(/style="[^"]*(?:position|inset)/);
        }
      });

    it('wires every portable prop through to the rendered HTML', () => {
      const hidden = KNOWN_GAPS.hiddenAttributes[component.tag] ?? {};
      const withEvery = renderRich(inContainer(component, sampleUsage(component)).markdown, SITE);
      for (const attribute of portableAttributes(component)) {
        const without = renderRich(inContainer(component, sampleUsage(component, attribute.name)).markdown, SITE);
        const reason = hidden[attribute.name];
        expect(without !== withEvery, reason ? `${attribute.name} is listed as inert: ${reason}` : `${attribute.name} changes nothing`).toBe(!reason);
      }
    });

    const booleanAttributes = portableAttributes(component).filter((candidate) => candidate.type === 'boolean');
    // Only components with a boolean prop get this case: for the rest it would assert nothing.
    if (booleanAttributes.length > 0)
      it('reads a JSX `{true}` boolean like a bare one and `{false}` like an absent one', () => {
        const bare = inContainer(component, sampleUsage(component)).markdown;
        for (const attribute of booleanAttributes) {
          const flag = new RegExp(` ${attribute.name}(?=[\\s/>])`);
          expect(flag.test(bare), `${attribute.name} sample`).toBe(true);
          expect(renderRich(bare.replace(flag, ` ${attribute.name}={true}`), SITE), `${attribute.name}={true}`).toBe(renderRich(bare, SITE));
          const absent = renderRich(inContainer(component, sampleUsage(component, attribute.name)).markdown, SITE);
          expect(renderRich(bare.replace(flag, ` ${attribute.name}={false}`), SITE), `${attribute.name}={false}`).toBe(absent);
        }
      });

    it('renders its content and props through the rich reader', () => {
      const sample = inContainer(component, sampleUsage(component));
      const html = renderRich(sample.markdown, SITE);
      expect(html).not.toMatch(new RegExp(`<\\/?${component.reader.tag}\\b`, 'i'));
      expect(html).not.toMatch(new RegExp(`&lt;\\/?${component.tag}\\b`, 'i'));
      for (const body of sample.bodies) expect(html, 'body').toContain(body);
      const hidden = KNOWN_GAPS.hiddenAttributes[component.tag] ?? {};
      if (component.tag === 'CardGroup') expect(html).toContain('sm:grid-cols-3');
      for (const attribute of portableAttributes(component)) {
        const value = sampleValue(component, attribute);
        if (attribute.type === 'string' && !(attribute.name in hidden)) expect(html, attribute.name).toContain(String(value));
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

  it('allows the same extra inline HTML tags as the reader (such as `u`)', () => {
    const template = quoted(between(markdown, 'tagNames: [...(defaultSchema.tagNames ?? []), ', '...componentTags]'));
    const defaults = new Set(defaultSchema.tagNames ?? []);
    // `mermaid` is synthesized by the Nibleaf reader only; the template has no Mermaid support.
    const components = new Set([...READER_TAGS, 'mermaid']);
    const reader = (sanitizeSchema.tagNames ?? []).filter((tag) => !defaults.has(tag) && !components.has(tag));
    expect(reader).toEqual(['u']);
    expect(sorted(template)).toEqual(sorted(reader));
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
