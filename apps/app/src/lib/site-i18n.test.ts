import { siteT } from '@nibleaf/i18n/site';
import { describe, expect, it } from 'vitest';

describe('published-site reader localization', () => {
  it('localizes reader controls and MDX defaults for Arabic language variants', () => {
    const t = siteT('ar-SA');

    expect(t('changeLanguage')).toBe('تغيير اللغة');
    expect(t('toggleTheme')).toBe('تبديل السمة');
    expect(t('articleDetails')).toBe('تفاصيل المقالة');
    expect(t('viewMarkdown')).toBe('عرض Markdown');
    expect(t('copyMarkdown')).toBe('نسخ Markdown');
    expect(t('copyCode')).toBe('نسخ الشيفرة');
    expect(t('copied')).toBe('تم النسخ');
    expect(t('details')).toBe('التفاصيل');
    expect(t('tab')).toBe('علامة التبويب');
    expect(t('required')).toBe('مطلوب');
    expect(t('deprecated')).toBe('مهمل');
    expect(t('defaultValue')).toBe('الافتراضي');
    expect(t('showProperties')).toBe('عرض الخصائص');
  });

  it('localizes shipped LTR languages and uses English for unshipped locales', () => {
    expect(siteT('en')('copyCode')).toBe('Copy code');
    expect(siteT('fr-CA')('showProperties')).toBe('Afficher les propriétés');
    expect(siteT('it')('showProperties')).toBe('Show properties');
  });
});
