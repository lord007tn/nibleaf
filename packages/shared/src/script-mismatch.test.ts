import { describe, expect, it } from 'vitest';
import { detectScriptMismatch, sampleForScript } from './script-mismatch';
import { constantGrowthLimit, growthMs, linearGrowthLimit } from './testing/growth';

const ARABIC_REFUND = 'خطوات إسترداد مبلغ على نظام إدارة الفنادق، ابدأ من قائمة الحجوزات ثم اختر الحجز المطلوب واضغط على زر الاسترداد.';
const ENGLISH_RESERVATION = 'To add a new reservation, open the front desk calendar, choose the room and the dates, then confirm the guest details.';
const ARABIC_INTRO = 'تشرح هذه الصفحة طريقة إعداد الخادم وتشغيله.';

describe('detectScriptMismatch', () => {
  it('flags Arabic content published under English', () => {
    expect(detectScriptMismatch(ARABIC_REFUND, 'en')).toEqual({ mismatch: true, dominantScript: 'arabic', ratio: 1 });
  });

  it('flags Arabic content that names Latin products, published under English', () => {
    const page = `${ARABIC_REFUND}\n\nخطوات إسترداد مبلغ على نظام PMS عبر لوحة Jood Booking.`;
    expect(detectScriptMismatch(page, 'en')).toMatchObject({ mismatch: true, dominantScript: 'arabic' });
  });

  it('flags English content published under Arabic', () => {
    expect(detectScriptMismatch(ENGLISH_RESERVATION, 'ar')).toMatchObject({ mismatch: true, dominantScript: 'latin' });
  });

  it('accepts content in the language it is published under', () => {
    expect(detectScriptMismatch(ARABIC_REFUND, 'ar').mismatch).toBe(false);
    expect(detectScriptMismatch(ENGLISH_RESERVATION, 'en-US').mismatch).toBe(false);
  });

  it('does not flag technical Arabic that names Latin products and commands', () => {
    const technical = [
      '# تثبيت Nibleaf على الخادم',
      'استخدم Docker Compose لتشغيل خدمة API ثم افتح لوحة التحكم في Chrome.',
      'نفّذ الأمر `pnpm install --frozen-lockfile` ثم `docker compose up -d` وانتقل إلى https://docs.example.com/getting-started.',
      '```bash\nexport DATABASE_URL=postgres://user:password@localhost:5432/nibleaf\n```',
      'راجع [دليل الإعداد](/guides/setup-with-github-actions) لمعرفة المزيد عن GitHub Actions.',
    ].join('\n\n');
    expect(detectScriptMismatch(technical, 'ar')).toMatchObject({ mismatch: false, dominantScript: 'arabic' });
  });

  it('does not flag a technical Arabic sentence dense with product names', () => {
    const result = detectScriptMismatch('استخدم Kubernetes و OpenTelemetry مع PostgreSQL لتوثيق API.', 'ar', { minLetters: 1 });
    expect(result).toMatchObject({ mismatch: false, dominantScript: 'arabic' });
  });

  it('does not flag an English page that quotes a few Arabic words', () => {
    const text = 'The Arabic interface labels the save button حفظ and the cancel button إلغاء, so translators should keep those strings.';
    expect(detectScriptMismatch(text, 'en').mismatch).toBe(false);
  });

  // Chinese, Japanese and Thai write whole paragraphs without spaces, so each one is a
  // single whitespace-free token far longer than the 64-character URL/hash cut-off.
  // That cut-off only applies to ASCII runs; letters are never dropped.
  describe('unspaced scripts longer than one token', () => {
    const CHINESE =
      '要添加新的预订，请打开前台日历，选择房间和日期，然后确认客人的详细信息并保存预订。退款时请先在预订列表中找到对应的订单，再点击退款按钮完成操作。';
    const JAPANESE =
      '新しい予約を追加するには、フロントデスクのカレンダーを開き、部屋と日付を選んでから、ゲストの詳細を確認して予約を保存してください。返金する場合は予約一覧から対象の予約を探してください。';
    const THAI =
      'หากต้องการเพิ่มการจองใหม่ให้เปิดปฏิทินของแผนกต้อนรับเลือกห้องและวันที่จากนั้นยืนยันรายละเอียดของแขกและบันทึกการจองเพื่อคืนเงินให้ค้นหาการจองในรายการแล้วกดปุ่มคืนเงิน';

    it.each([
      ['Chinese', CHINESE, 'zh', 'han'],
      ['Japanese', JAPANESE, 'ja', undefined],
      ['Thai', THAI, 'th', 'thai'],
    ] as const)('detects an unspaced %s paragraph on English and accepts it on its own locale', (_, text, locale, script) => {
      expect(text.split(/\s/u).some((token) => token.length > 64)).toBe(true);
      expect(sampleForScript(text)).toBe(text);
      const onEnglish = detectScriptMismatch(text, 'en');
      expect(onEnglish.mismatch).toBe(true);
      if (script) expect(onEnglish.dominantScript).toBe(script);
      expect(detectScriptMismatch(text, locale).mismatch).toBe(false);
    });

    it('still drops long ASCII runs such as URLs and hashes', () => {
      const hash = 'a1b2c3d4'.repeat(10);
      expect(sampleForScript(`See ${hash} now`)).toBe('See   now');
    });

    // A hash or URL glued to unspaced prose, with no space between them: the ASCII
    // part drops and the Han part stays, so zh is not flagged by the Latin letters.
    it('drops a long hash glued to Chinese prose and keeps the prose', () => {
      const hash = 'a1b2c3d4e5f6'.repeat(8);
      const glued = `${CHINESE}${hash}${CHINESE}`;
      expect(glued.split(/\s/u)).toHaveLength(1);
      expect(sampleForScript(glued)).toBe(`${CHINESE} ${CHINESE}`);
      expect(detectScriptMismatch(glued, 'zh').mismatch).toBe(false);
      expect(detectScriptMismatch(glued, 'en')).toMatchObject({ mismatch: true, dominantScript: 'han' });
      // A URL glued on one side, and short Latin words inside the prose, behave the same.
      const url = `https://example.com/${'path/'.repeat(20)}`;
      expect(sampleForScript(`${CHINESE}${url}`)).toBe(`${CHINESE} `);
      expect(sampleForScript(`${CHINESE}API${CHINESE}`)).toBe(`${CHINESE}API${CHINESE}`);
    });
  });

  describe('ignores code', () => {
    const cases: Array<[string, string]> = [
      [
        'indented code',
        `${ARABIC_INTRO}\n\n    const server = createServer({ port: 3000, host: 'localhost' });\n    server.listen(() => console.log('listening on port'));\n`,
      ],
      [
        'raw <pre><code>',
        `${ARABIC_INTRO}\n\n<pre><code>const server = createServer({ port: 3000, host: 'localhost' });\nserver.listen(() => console.log('listening'));</code></pre>\n`,
      ],
      ['multi-backtick spans', `${ARABIC_INTRO} ثم شغّل \`\`const value = \`template\` + anotherLongIdentifierName\`\` في الطرفية.`],
      ['inline raw <code>', `${ARABIC_INTRO} ثم شغّل <code>docker compose up --detach --remove-orphans</code> في الطرفية.`],
      ['fenced code', `${ARABIC_INTRO}\n\n~~~js\nconst server = createServer({ port: 3000, host: 'localhost' });\n~~~\n`],
    ];
    it.each(cases)('%s on an Arabic page', (_name, page) => {
      expect(detectScriptMismatch(page, 'ar')).toMatchObject({ mismatch: false, dominantScript: 'arabic', ratio: 1 });
    });
  });

  it('ignores link destinations, bare URLs, emails, images and HTML attributes', () => {
    const page = [
      ARABIC_INTRO,
      'راجع [الدليل](https://docs.example.com/very/long/english/path/to/the/setup/guide) أو https://example.com/another/english/path.',
      'راسلنا على support-team-for-reservations@example-company.com.',
      '![server architecture overview diagram](/images/architecture-overview.png)',
      '<div title="an english attribute value that is fairly long">نص عربي داخل وسم</div>',
      '[ref]: https://example.com/reference/definition/target',
    ].join('\n\n');
    expect(detectScriptMismatch(page, 'ar')).toMatchObject({ mismatch: false, dominantScript: 'arabic', ratio: 1 });
  });

  it('does not judge text that is too short or empty', () => {
    expect(detectScriptMismatch('', 'en')).toEqual({ mismatch: false, dominantScript: null, ratio: 0 });
    expect(detectScriptMismatch('   \n```js\nconst a = 1;\n```', 'ar')).toEqual({ mismatch: false, dominantScript: null, ratio: 0 });
    expect(detectScriptMismatch('مرحبا', 'en')).toMatchObject({ mismatch: false, dominantScript: 'arabic' });
    expect(detectScriptMismatch('مرحبا', 'en', { minLetters: 3 }).mismatch).toBe(true);
  });

  it('does not flag an evenly mixed page below the threshold', () => {
    const half = 'reservations الحجوزات calendar التقويم guests الضيوف payments المدفوعات reports التقارير';
    const result = detectScriptMismatch(half, 'en');
    expect(result.ratio).toBeLessThan(0.6);
    expect(result.mismatch).toBe(false);
  });

  it('never flags a language whose script it does not know', () => {
    expect(detectScriptMismatch(ARABIC_REFUND, 'xx').mismatch).toBe(false);
  });

  it('follows an explicit script subtag and multi-script languages', () => {
    expect(detectScriptMismatch(ENGLISH_RESERVATION, 'sr-Latn').mismatch).toBe(false);
    expect(detectScriptMismatch(ENGLISH_RESERVATION, 'sr').mismatch).toBe(false);
    expect(detectScriptMismatch('東京の新しいホテルで予約を管理する方法を説明します。チェックインとチェックアウトの手順です。', 'ja').mismatch).toBe(
      false,
    );
  });

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

  it('samples a bounded window from long pages and still finds a mismatch', () => {
    const arabic = 'هذه صفحة مكتوبة باللغة العربية لكنها منشورة تحت اللغة الإنجليزية. ';
    const page = `${arabic.repeat(800)}`;
    expect(page.length).toBeGreaterThan(40_000);
    expect(sampleForScript(page).length).toBeLessThanOrEqual(16_384 + 4);
    expect(detectScriptMismatch(page, 'en')).toMatchObject({ mismatch: true, dominantScript: 'arabic' });
  });
});
