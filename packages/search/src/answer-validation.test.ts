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

  it('treats bold section labels like headings (live model output)', () => {
    const chunks = [chunk, { ...chunk, id: 'c2', pageId: 'p2' }, { ...chunk, id: 'c3', pageId: 'p3' }];
    const text =
      'You can export notes as Markdown from the app or the CLI. [S1]\n\n**From the app**\n\n1. Open a notebook.\n2. Choose **More → Export**.\n3. Pick **Markdown**.\n4. Select **Download**. One export can include up to 500 notes. [S3]\n\n**From the CLI:**\n\nRun:\n\n```bash\nacme export --format markdown --out ./backup\n```\n\nTo export a single notebook, add `--notebook <name>`. [S2]';
    expect(validateCitedAnswer(text, chunks, 'export', 'chat')).toMatchObject({ status: 'answered', answer: text, droppedParagraphs: 0 });
    // A bold sentence that states a fact is still a claim that needs a source.
    expect(validateCitedAnswer('**Exports are unlimited.**\n\nUse s3 [S1]', [chunk], 'x', 'chat')).toMatchObject({ status: 'no_answer' });
    expect(validateCitedAnswer('**من التطبيق:**\n\nاستخدم s3 [S1]', [chunk], 'x', 'chat')).toMatchObject({ status: 'answered' });
    expect(
      validateCitedAnswer('**Exports are unlimited and free for everyone on every plan today.** Really.\n\nUse s3 [S1]', [chunk], 'x', 'chat'),
    ).toMatchObject({
      status: 'no_answer',
    });
  });

  it('removes an uncited opening summary instead of withdrawing cited steps (live model output)', () => {
    const chunks = [chunk, { ...chunk, id: 'c2', pageId: 'p2' }, { ...chunk, id: 'c3', pageId: 'p3' }];
    const steps =
      '**From the app**\n\n1. Open a notebook.\n2. Select **Download**. One export can include up to 500 notes. [S3]\n\n**From the CLI**\n\nTo export a single notebook, add `--notebook <name>`. [S2]';
    expect(validateCitedAnswer(`You can export from the app or with the CLI.\n\n${steps}`, chunks, 'export', 'chat')).toMatchObject({
      status: 'answered',
      answer: steps,
      droppedParagraphs: 1,
    });
  });

  it('still drops a trailing uncited heading but keeps cited ones', () => {
    expect(validateCitedAnswer('## Setup\n\nUse s3 [S1]\n\n##\tNext steps', [chunk], 'storage', 'chat')).toMatchObject({
      status: 'answered',
      answer: '## Setup\n\nUse s3 [S1]',
    });
  });
});
