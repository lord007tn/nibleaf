import { describe, expect, it } from 'vitest';
import { detectScriptMismatch, sampleForScript } from './script-mismatch';
import { constantGrowthLimit, growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('detectScriptMismatch growth', () => {
  // Publish checks run this on every page, so hostile input must never block.
  // Each bound times the same detection at two input sizes on the same runner
  // (testing/growth), so a slow CI core slows both sides equally. Everything
  // past the 16 KB sample costs nothing more, so growth is measured inside it:
  // 4,000 characters against 16,000.
  describe('cost bounds', () => {
    const detect = (input: string) => detectScriptMismatch(input, 'en');
    /** A fresh, equivalent input every call (testing/growth `vary`): nothing can be served from a cache. */
    const fresh = { vary: (input: string, rep: number) => `${input} ${rep}` };
    /** Ordinary prose in one script, cut to a given length. */
    const prose = (sentence: string, length: number): string => sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
    const CHINESE_SENTENCE = '要添加新的预订，请打开前台日历，选择房间和日期，然后确认客人的详细信息。';
    const THAI_SENTENCE = 'หากต้องการเพิ่มการจองใหม่ให้เปิดปฏิทินเลือกห้องและวันที่แล้วยืนยันรายละเอียดของแขก ';
    const SMALL = 4000;

    // These lose their giant ASCII tokens in the pre-pass or exceed the marker
    // guard, so they take the linear prose scan.
    it.each([
      ['a long email', (n: number) => `${'a'.repeat(n / 2)}@${'b'.repeat(n / 2)}`],
      ['one long word', (n: number) => 'a'.repeat(n)],
      ['a@ repeated', (n: number) => 'a@'.repeat(n / 2)],
      ['dotted emails', (n: number) => 'a.b@c.'.repeat(Math.ceil(n / 6))],
      ['an <a flood', (n: number) => '<a'.repeat(n / 2)],
      ['a comment flood', (n: number) => '<!--'.repeat(n / 4)],
      ['a long URL', (n: number) => `https://${'x'.repeat(n)}`],
      ['a backtick flood', (n: number) => '`'.repeat(n)],
      ['emphasis markers', (n: number) => '*a '.repeat(Math.ceil(n / 3))],
      ['brackets', (n: number) => '[a]('.repeat(n / 4)],
      ['Han emphasis markers', (n: number) => '*字'.repeat(n / 2)],
      ['Han brackets', (n: number) => '[字]('.repeat(n / 4)],
    ] as const)('stays linear on %s', (_, build) => {
      const [small, large] = growthMs(detect, build(SMALL), build(4 * SMALL), fresh);
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    });

    // Unspaced CJK and Thai runs are kept (they may be prose), so they take the
    // Markdown parser, where superlinear growth would show.
    it.each([
      ['one long Han run', (n: number) => '字'.repeat(n)],
      ['one long Thai run', (n: number) => 'กข'.repeat(n / 2)],
      // Alternating scripts in one token: every run is short, so the split keeps them all.
      ['a long token alternating Latin and Han', (n: number) => 'a字'.repeat(n / 2)],
      ['a long token of long hashes glued to Han', (n: number) => `${'f'.repeat(70)}字`.repeat(Math.ceil(n / 71))],
    ] as const)('stays bounded on %s', (_, build) => {
      const [small, large] = growthMs(detect, build(SMALL), build(4 * SMALL), fresh);
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    });

    // All per-character work runs on the sample, so 64k costs what 16k does.
    it.each([
      ['Han', CHINESE_SENTENCE],
      ['Thai', THAI_SENTENCE],
    ])('samples %s prose before any per-character work', (_, sentence) => {
      const long = prose(sentence, 65_536);
      expect(sampleForScript(long).length).toBeLessThanOrEqual(16_384 + 4);
      const [small, large] = growthMs(detect, prose(sentence, 16_384), long, { ...fresh, minMs: 12 });
      expect(large).toBeLessThanOrEqual(constantGrowthLimit(small));
    });
  });

  // A long, realistic page is analysed on a bounded sample (16 KB at most), where
  // its many markers send it to the linear scan. Growth is timed on the Markdown
  // parser path, where superlinear cost could hide: 12 steps against 48, both
  // under the 400-marker guard (8 markers a step).
  it('stays bounded on a long, ordinary page', () => {
    const page = (steps: number) =>
      Array.from(
        { length: steps },
        (_, index) => `## Step ${index}\n\nOpen **Settings** and choose [Users](/users) to add a guest. Run \`npm install\` first.\n`,
      ).join('\n');
    expect(detectScriptMismatch(page(400), 'en').mismatch).toBe(false);
    const [small, large] = growthMs((input: string) => detectScriptMismatch(input, 'en'), page(12), page(48), {
      vary: (input, rep) => `${input} ${rep}`,
    });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
