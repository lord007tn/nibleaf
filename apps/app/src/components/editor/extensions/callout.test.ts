import { describe, expect, it } from 'vitest';
import { calloutVariantAttributes } from './callout';

describe('callout type changes', () => {
  it('keeps custom attributes and changes both authored tags', () => {
    expect(calloutVariantAttributes({ sourceOpen: '<Note title="Read this" icon="book">', sourceClose: '</Note>' }, 'warning')).toEqual({
      variant: 'warning',
      sourceOpen: '<Warning title="Read this" icon="book">',
      sourceClose: '</Warning>',
    });
  });
  it('changes generic callout types without dropping their titles', () => {
    expect(calloutVariantAttributes({ sourceOpen: '<Callout type="note" title="Read this">', sourceClose: '</Callout>' }, 'tip')).toEqual({
      variant: 'tip',
      sourceOpen: '<Callout type="tip" title="Read this">',
      sourceClose: '</Callout>',
    });
  });
});
