import { describe, expect, it } from 'vitest';
import catalogV1 from './__fixtures__/documentation-component-catalog.v1.json';
import { DOCUMENTATION_COMPONENT_CONTRACT } from './documentation-component-contract';
import {
  DOCUMENTATION_COMPONENT_CATALOG,
  DOCUMENTATION_COMPONENTS,
  type DocumentationComponentCapability,
  documentationComponentTags,
} from './documentation-components';

describe('documentation component catalog', () => {
  it('uses unique ids and MDX tags', () => {
    const ids = DOCUMENTATION_COMPONENT_CATALOG.map((component) => component.id);
    const tags = documentationComponentTags();
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tags.map((tag) => tag.toLowerCase())).size).toBe(tags.length);
  });

  it('only references catalogued MDX children', () => {
    const tags = new Set(documentationComponentTags());
    const children = DOCUMENTATION_COMPONENT_CATALOG.flatMap((component: DocumentationComponentCapability) => component.allowedChildren ?? []);
    expect(children.filter((tag) => !tags.has(tag))).toEqual([]);
  });

  it('publishes the authored-only high-value additions', () => {
    expect(documentationComponentTags()).toEqual(
      expect.arrayContaining(['FileTree', 'Folder', 'File', 'ApiExample', 'RequestExample', 'ResponseExample', 'RelatedContent', 'RelatedCard']),
    );
  });

  it('describes the portable lowest-common behavior', () => {
    expect(DOCUMENTATION_COMPONENT_CATALOG.find((component) => component.id === 'banner')?.attributes).toEqual(['type']);
    expect(DOCUMENTATION_COMPONENT_CATALOG.find((component) => component.id === 'tooltip')?.visualEditor).toBe(true);
    expect(DOCUMENTATION_COMPONENT_CATALOG.find((component) => component.id === 'icon')?.attributes).toEqual(
      expect.arrayContaining(['icon', 'name']),
    );
  });

  // The catalog is served to API and MCP clients under DOCUMENTATION_COMPONENT_SCHEMA_VERSION.
  // Changing it is a deliberate public-contract change: update the fixture (and the version
  // when the change is not purely additive).
  it('keeps the published v1 catalog unchanged', () => {
    expect(JSON.parse(JSON.stringify(DOCUMENTATION_COMPONENT_CATALOG))).toEqual(catalogV1);
  });
});

describe('documentation component registry', () => {
  it('describes every reader-contract component exactly once', () => {
    const registered = DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag ? [component.tag] : []));
    expect([...registered].sort()).toEqual(Object.keys(DOCUMENTATION_COMPONENT_CONTRACT).sort());
  });

  it('only gives enum values to enum attributes and keeps defaults among them', () => {
    for (const component of DOCUMENTATION_COMPONENTS) {
      for (const attribute of component.attributes) {
        if (attribute.values) expect(attribute.type, `${component.id}.${attribute.name}`).toMatch(/^(enum|number|color)$/);
        if (attribute.type === 'enum') expect(attribute.values?.length, `${component.id}.${attribute.name}`).toBeGreaterThan(0);
        if (attribute.values && attribute.default !== undefined) expect(attribute.values).toContain(String(attribute.default));
        if (attribute.type === 'boolean' && attribute.default !== undefined) expect(typeof attribute.default).toBe('boolean');
      }
    }
  });

  it('lists the components that may be authored self-closing', () => {
    const selfClosing = DOCUMENTATION_COMPONENTS.filter((component) => component.selfClosing).map((component) => component.tag);
    expect(selfClosing).toEqual(['Icon', 'File', 'RelatedCard']);
  });
});
