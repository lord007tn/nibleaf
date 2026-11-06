import { describe, expect, it } from 'vitest';
import { validateCitedAnswer } from './answer-validation';
import type { SearchChunk } from './hybrid';

const chunk: SearchChunk = {
  id: 'c',
  pageId: 'p',
  ordinal: 0,
  title: 'Storage',
  path: 'storage',
  description: '',
  heading: 'Config',
  headingPath: [],
  content: 'Use s3',
  contentHash: 'h',
  language: 'en',
  direction: 'ltr',
  visible: true,
};

describe('chat heading detection', () => {
  it('stays linear on a hash followed by a long run of spaces', () => {
    const started = performance.now();
    const result = validateCitedAnswer(`Use s3 [S1]\n\n#${' '.repeat(50_000)}x\n\nMore s3 [S1]`, [chunk], 'storage', 'chat');
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ status: 'answered' });
  });

  it('still drops a trailing uncited heading but keeps cited ones', () => {
    expect(validateCitedAnswer('## Setup\n\nUse s3 [S1]\n\n##\tNext steps', [chunk], 'storage', 'chat')).toMatchObject({
      status: 'answered',
      answer: '## Setup\n\nUse s3 [S1]',
    });
  });
});
