import { describe, expect, it } from 'vitest';
import { siteT } from './site';
import { siteAccessT } from './site-access';
import { siteChatT } from './site-chat';

describe('reader counts', () => {
  it('uses every Arabic plural form', () => {
    const t = siteT('ar');
    expect([1, 2, 5, 11, 100].map((count) => t('changelogPageCount', { count }))).toEqual(['صفحة واحدة', 'صفحتان', '5 صفحات', '11 صفحة', '100 صفحة']);
    expect([1, 2, 7, 15].map((count) => t('minReadCount', { count }))).toEqual([
      'دقيقة واحدة للقراءة',
      'دقيقتان للقراءة',
      '7 دقائق للقراءة',
      '15 دقيقة للقراءة',
    ]);
    expect([2, 3, 11].map((count) => t('screenshotCount', { count }))).toEqual(['لقطتا شاشة', '3 لقطات شاشة', '11 لقطة شاشة']);
  });

  it('keeps English and Russian forms grammatical', () => {
    expect([1, 2].map((count) => siteT('en')('screenshotCount', { count }))).toEqual(['1 screenshot', '2 screenshots']);
    expect(siteT('en')('minReadCount', { count: 1 })).toBe('1 min read');
    expect([1, 3, 5].map((count) => siteT('ru')('changelogPageCount', { count }))).toEqual(['1 страница', '3 страницы', '5 страниц']);
  });

  it('keeps the private-site copy out of siteT, in its own lazy translator', () => {
    expect(siteAccessT('ar')('privateSignIn')).toBe('تسجيل الدخول');
    expect(siteT('ar')('privateTitle')).toBe('هذا التوثيق خاص');
  });

  it('counts the chat retention period in days, in English and every Arabic form', () => {
    expect([1, 90].map((count) => siteChatT('en')('aiSaved', { count }))).toEqual([
      "Questions are kept for 1 day to help improve these docs. Please don't include personal details.",
      "Questions are kept for 90 days to help improve these docs. Please don't include personal details.",
    ]);
    expect([1, 2, 7, 90, 100].map((count) => siteChatT('ar')('aiSaved', { count }).split(' للمساعدة')[0])).toEqual([
      'تُحفظ الأسئلة لمدة يوم واحد',
      'تُحفظ الأسئلة لمدة يومين',
      'تُحفظ الأسئلة لمدة 7 أيام',
      'تُحفظ الأسئلة لمدة 90 يومًا',
      'تُحفظ الأسئلة لمدة 100 يوم',
    ]);
  });
});
