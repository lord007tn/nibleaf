import { describe, expect, it } from 'vitest';
import { detectScriptMismatch, sampleForScript } from './script-mismatch';

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
  // Bounds are calibrated like against like on the same machine, so slow CI
  // cores slow both sides equally while superlinear growth still shows.
  describe('cost bounds', () => {
    /** Median of three detections, each with a unique suffix (no cache can help). */
    const detectionMs = (input: string): number => {
      detectScriptMismatch('Warm up with a short English sentence here.', 'en');
      const runs: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        const started = performance.now();
        detectScriptMismatch(`${input}${Math.random()}`, 'en');
        runs.push(performance.now() - started);
      }
      return runs.sort((a, b) => a - b)[1] ?? 0;
    };
    /** A plain linear pass over the same input (median of three). */
    const linearPassMs = (input: string): number => {
      const runs: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        const started = performance.now();
        let letters = 0;
        for (let index = 0; index < input.length; index += 1) if (/\p{L}/u.test(input[index] ?? '')) letters += 1;
        if (letters < 0) throw new Error('unreachable');
        runs.push(performance.now() - started);
      }
      return runs.sort((a, b) => a - b)[1] ?? 0;
    };
    /** Ordinary prose in one script, cut to a given length. */
    const prose = (sentence: string, length: number): string => sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
    const CHINESE_SENTENCE = '要添加新的预订，请打开前台日历，选择房间和日期，然后确认客人的详细信息。';
    const THAI_SENTENCE = 'หากต้องการเพิ่มการจองใหม่ให้เปิดปฏิทินเลือกห้องและวันที่แล้วยืนยันรายละเอียดของแขก ';

    // These lose their giant ASCII tokens in the pre-pass or exceed the marker
    // guard, so they take the linear prose scan.
    it.each([
      ['an 80k-character email', `${'a'.repeat(40_000)}@${'b'.repeat(40_000)}`],
      ['one 80k-letter word', 'a'.repeat(80_000)],
      ['a@ repeated', 'a@'.repeat(20_000)],
      ['dotted emails', 'a.b@c.'.repeat(8000)],
      ['an <a flood', '<a'.repeat(20_000)],
      ['a comment flood', '<!--'.repeat(10_000)],
      ['a 40k-character URL', `https://${'x'.repeat(40_000)}`],
      ['a backtick flood', '`'.repeat(20_000)],
      ['emphasis markers', '*a '.repeat(30_000)],
      ['brackets', '[a]('.repeat(20_000)],
      ['Han emphasis markers', '*字'.repeat(40_000)],
      ['Han brackets', '[字]('.repeat(20_000)],
    ])('stays linear on %s', (_, input) => {
      expect(detectionMs(input)).toBeLessThanOrEqual(10 * linearPassMs(input) + 20);
    });

    // Unspaced CJK and Thai runs are kept (they may be prose), so they take the
    // Markdown parser on the 16 KB sample: bounded by parsing ordinary prose of
    // the same size and script.
    it.each([
      ['one 80k-character Han run', '字'.repeat(80_000), CHINESE_SENTENCE],
      ['one 80k-character Thai run', 'กข'.repeat(40_000), THAI_SENTENCE],
    ])('stays bounded on %s', (_, input, sentence) => {
      expect(detectionMs(input)).toBeLessThanOrEqual(5 * detectionMs(prose(sentence, input.length)) + 20);
    });

    // All per-character work runs on the sample, so 80k costs what 16k does.
    it.each([
      ['Han', CHINESE_SENTENCE],
      ['Thai', THAI_SENTENCE],
    ])('samples %s prose before any per-character work', (_, sentence) => {
      const long = prose(sentence, 80_000);
      expect(sampleForScript(long).length).toBeLessThanOrEqual(16_384 + 4);
      expect(detectionMs(long)).toBeLessThanOrEqual(3 * detectionMs(prose(sentence, 16_384)) + 20);
    });
  });

  // A long, realistic page still goes through the Markdown parser, but only on
  // a bounded sample (16 KB at most). About 5–15 ms locally. The bound leaves room
  // for slow CI runners while still catching a superlinear path.
  it('stays bounded on a long, ordinary page', () => {
    const page = Array.from(
      { length: 400 },
      (_, index) => `## Step ${index}\n\nOpen **Settings** and choose [Users](/users) to add a guest. Run \`npm install\` first.\n`,
    ).join('\n');
    detectScriptMismatch('Warm up with a short English sentence here.', 'en');
    const started = performance.now();
    expect(detectScriptMismatch(page, 'en').mismatch).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('samples a bounded window from long pages and still finds a mismatch', () => {
    const arabic = 'هذه صفحة مكتوبة باللغة العربية لكنها منشورة تحت اللغة الإنجليزية. ';
    const page = `${arabic.repeat(800)}`;
    expect(page.length).toBeGreaterThan(40_000);
    expect(sampleForScript(page).length).toBeLessThanOrEqual(16_384 + 4);
    expect(detectScriptMismatch(page, 'en')).toMatchObject({ mismatch: true, dominantScript: 'arabic' });
  });
});
