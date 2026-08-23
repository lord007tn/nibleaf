import { describe, expect, it } from 'vitest';
import { DOCUMENTATION_COMPONENT_CATALOG, type DocumentationComponentCapability, documentationComponentTags } from './documentation-components';

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
});
