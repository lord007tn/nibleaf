import { describe, expect, it } from 'vitest';
import { blockDirection, detectScriptMismatch, dominantDirection, firstStrongDirection, isRtlLanguage } from './script-direction';

const ARABIC_REFUND = 'خطوات إسترداد مبلغ على نظام إدارة الفنادق، ابدأ من قائمة الحجوزات ثم اختر الحجز المطلوب واضغط على زر الاسترداد.';
const ENGLISH_RESERVATION = 'To add a new reservation, open the front desk calendar, choose the room and the dates, then confirm the guest details.';

describe('detectScriptMismatch', () => {
  it('flags Arabic content published under English', () => {
    const result = detectScriptMismatch(ARABIC_REFUND, 'en');
    expect(result.mismatch).toBe(true);
    expect(result.dominantScript).toBe('arabic');
    expect(result.ratio).toBe(1);
  });

  it('flags English content published under Arabic', () => {
    const result = detectScriptMismatch(ENGLISH_RESERVATION, 'ar');
    expect(result).toMatchObject({ mismatch: true, dominantScript: 'latin' });
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
    const result = detectScriptMismatch(technical, 'ar');
    expect(result.mismatch).toBe(false);
    expect(result.dominantScript).toBe('arabic');
  });

  it('does not flag an English page that quotes a few Arabic words', () => {
    const text = 'The Arabic interface labels the save button حفظ and the cancel button إلغاء, so translators should keep those strings.';
    expect(detectScriptMismatch(text, 'en').mismatch).toBe(false);
  });

  it('does not judge text that is too short or empty', () => {
    expect(detectScriptMismatch('', 'en')).toEqual({ mismatch: false, dominantScript: null, ratio: 0 });
    expect(detectScriptMismatch('   \n```js\nconst a = 1;\n```', 'ar')).toEqual({ mismatch: false, dominantScript: null, ratio: 0 });
    expect(detectScriptMismatch('مرحبا', 'en')).toMatchObject({ mismatch: false, dominantScript: 'arabic' });
    expect(detectScriptMismatch('مرحبا', 'en', { minLetters: 3 }).mismatch).toBe(true);
  });

  it('does not flag an evenly mixed page below the threshold', () => {
    const half = 'Reservations الحجوزات Calendar التقويم Guests الضيوف Payments المدفوعات Reports التقارير';
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
});

describe('blockDirection', () => {
  it('lets the browser decide when the first word matches most words', () => {
    expect(blockDirection(ARABIC_REFUND)).toBe('auto');
    expect(blockDirection(ENGLISH_RESERVATION)).toBe('auto');
    expect(blockDirection('Click حفظ to save the reservation')).toBe('auto');
  });

  it('keeps technical Arabic right to left when it opens with a Latin product name', () => {
    expect(blockDirection('Nibleaf يتيح لك إدارة التوثيق بسهولة')).toBe('rtl');
    expect(blockDirection('PMS خطوات إسترداد مبلغ على نظام')).toBe('rtl');
  });

  it('keeps English left to right when it opens with an Arabic word', () => {
    expect(blockDirection('حفظ is the label of the save button in the Arabic interface')).toBe('ltr');
  });

  it('inherits for text without letters or evenly split', () => {
    expect(blockDirection('')).toBeUndefined();
    expect(blockDirection('2026-10-17 · 5 / 12')).toBeUndefined();
    expect(blockDirection('PMS نظام')).toBeUndefined();
  });
});

describe('direction primitives', () => {
  it('finds the first strong letter, skipping digits and punctuation', () => {
    expect(firstStrongDirection('123 – (مرحبا) hello')).toBe('rtl');
    expect(firstStrongDirection('٣٤٥ hello')).toBe('ltr');
    expect(firstStrongDirection('… 42')).toBeUndefined();
  });

  it('counts words for the dominant direction', () => {
    expect(dominantDirection('API واجهة برمجة التطبيقات')).toBe('rtl');
    expect(dominantDirection('the API and التطبيقات')).toBe('ltr');
    expect(dominantDirection('one واحد')).toBeUndefined();
  });

  it('knows right-to-left languages, honoring script subtags', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he-IL')).toBe(true);
    expect(isRtlLanguage('fa_IR')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('az-Arab')).toBe(true);
    expect(isRtlLanguage('ku-Latn')).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});
