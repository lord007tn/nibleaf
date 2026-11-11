import { describe, expect, it } from 'vitest';
import { detectScriptMismatch } from './script-mismatch';

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

  describe('ignores code', () => {
    const cases: Array<[string, string]> = [
      ['indented code', `${ARABIC_INTRO}\n\n    const server = createServer({ port: 3000, host: 'localhost' });\n    server.listen(() => console.log('listening on port'));\n`],
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
    expect(detectScriptMismatch('東京の新しいホテルで予約を管理する方法を説明します。チェックインとチェックアウトの手順です。', 'ja').mismatch).toBe(false);
  });

  it('stays fast on adversarial input', () => {
    const inputs = [
      `${'a'.repeat(40_000)}@${'b'.repeat(40_000)}`,
      'a@'.repeat(20_000),
      'a.b@c.'.repeat(8_000),
      '<a'.repeat(20_000),
      '<!--'.repeat(10_000),
      `https://${'x'.repeat(40_000)}`,
      '`'.repeat(20_000),
    ];
    for (const input of inputs) {
      const started = performance.now();
      detectScriptMismatch(input, 'en');
      expect(performance.now() - started, input.slice(0, 12)).toBeLessThan(750);
    }
  });
});
