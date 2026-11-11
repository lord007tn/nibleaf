import { describe, expect, it } from 'vitest';
import {
  blockDirection,
  dominantDirection,
  firstStrongDirection,
  isRtlLanguage,
  mergeTallies,
  tallyBlockDirection,
  tallyText,
} from './script-direction';

const ARABIC_REFUND = 'خطوات إسترداد مبلغ على نظام إدارة الفنادق، ابدأ من قائمة الحجوزات ثم اختر الحجز المطلوب واضغط على زر الاسترداد.';
const ENGLISH_RESERVATION = 'To add a new reservation, open the front desk calendar, choose the room and the dates, then confirm the guest details.';

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

  it('reads Persian, Urdu and Hebrew as right to left', () => {
    expect(blockDirection('این راهنما نحوه افزودن رزرو جدید را توضیح می‌دهد')).toBe('auto');
    expect(firstStrongDirection('یہ رہنما نئی بکنگ شامل کرنے کا طریقہ بتاتا ہے')).toBe('rtl');
    expect(firstStrongDirection('המדריך מסביר איך להוסיף הזמנה חדשה')).toBe('rtl');
  });

  it('inherits for text without letters or evenly split', () => {
    expect(blockDirection('')).toBeUndefined();
    expect(blockDirection('2026-10-17 · 5 / 12')).toBeUndefined();
    expect(blockDirection('PMS نظام')).toBeUndefined();
  });
});

describe('bidi classes', () => {
  it('treats tatweel, a Common-script letter, as right to left', () => {
    expect(firstStrongDirection('ـ')).toBe('rtl');
    expect(firstStrongDirection('ــ hello')).toBe('rtl');
  });

  it('treats Hanifi Rohingya, outside the Arabic script, as right to left', () => {
    // U+10D00 HANIFI ROHINGYA LETTER A, U+10D01 LETTER BA
    expect(firstStrongDirection('\u{10D00}\u{10D01} text')).toBe('rtl');
    expect(isRtlLanguage('rhg')).toBe(true);
    expect(isRtlLanguage('rhg-Rohg')).toBe(true);
  });

  it('ignores tashkeel, digits and punctuation', () => {
    expect(firstStrongDirection('َِ 123 – (مرحبا) hello')).toBe('rtl');
    expect(firstStrongDirection('٣٤٥ hello')).toBe('ltr');
    expect(firstStrongDirection('… 42')).toBeUndefined();
  });
});

describe('tallies', () => {
  it('counts words for the dominant direction', () => {
    expect(dominantDirection('API واجهة برمجة التطبيقات')).toBe('rtl');
    expect(dominantDirection('the API and التطبيقات')).toBe('ltr');
    expect(dominantDirection('one واحد')).toBeUndefined();
  });

  it('merges runs separated by a word boundary', () => {
    const merged = mergeTallies(tallyText('Nibleaf'), tallyText('يتيح لك'));
    expect(merged).toEqual({ first: 'ltr', ltr: 1, rtl: 2 });
    expect(tallyBlockDirection(merged)).toBe('rtl');
  });
});

describe('isRtlLanguage', () => {
  it('knows right-to-left languages, honoring script subtags', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he-IL')).toBe(true);
    expect(isRtlLanguage('fa_IR')).toBe(true);
    expect(isRtlLanguage('ur')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('az-Arab')).toBe(true);
    expect(isRtlLanguage('ku-Latn')).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});
