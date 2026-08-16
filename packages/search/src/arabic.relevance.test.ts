import { describe, expect, it } from 'vitest';
import { createDocIndex, type SearchDoc, searchDocs } from './index';

const docs: SearchDoc[] = [
  { id: 'user-exact', title: 'إدارة المستخدم', path: 'user', description: '', headings: '', content: 'إعداد مستخدم واحد.' },
  { id: 'users-inflected', title: 'دليل للمستخدمين', path: 'users', description: '', headings: '', content: 'إدارة حساباتهم وصلاحياتهم.' },
  { id: 'account-exact', title: 'إعداد الحساب', path: 'account', description: '', headings: '', content: 'خيارات الحساب.' },
  { id: 'accounts-inflected', title: 'إعدادات الحسابات', path: 'accounts', description: '', headings: '', content: 'الخيارات المتقدمة.' },
  { id: 'library', title: 'المكتبتان الرقميتان', path: 'library', description: '', headings: '', content: 'استخدام المكتبات.' },
  { id: 'permissions', title: 'ضبط الصلاحيات', path: 'permissions', description: '', headings: '', content: 'صلاحية الوصول.' },
  { id: 'notifications', title: 'إدارة الإشعارات', path: 'notifications', description: '', headings: '', content: 'إشعار المستخدم.' },
  { id: 'api-prose', title: 'API للمستخدمين', path: 'api-users', description: '', headings: '', content: 'واجهة برمجية للمطورين.' },
  { id: 'api-identifier', title: 'APIالمستخدمين', path: 'identifier', description: '', headings: '', content: 'معرف تقني.' },
  { id: 'city', title: 'الرياض', path: 'riyadh', description: '', headings: '', content: 'موقع المكتب.' },
  { id: 'laws', title: 'قوانين الاستخدام', path: 'laws', description: '', headings: '', content: 'سياسة النشر.' },
  { id: 'programming', title: 'أساسيات البرمجة', path: 'programming', description: '', headings: '', content: 'دليل التطوير.' },
];

interface Judgment {
  query: string;
  grades: Record<string, number>;
}

const judgments: Judgment[] = [
  { query: 'المستخدم', grades: { 'user-exact': 3, 'users-inflected': 1 } },
  { query: 'إعداد الحساب', grades: { 'account-exact': 3, 'accounts-inflected': 1 } },
  { query: 'مكتبة', grades: { library: 3 } },
  { query: 'صلاحية', grades: { permissions: 3 } },
  { query: 'إشعار', grades: { notifications: 3 } },
  { query: 'مستخدك', grades: { 'user-exact': 3, 'users-inflected': 1 } },
  { query: 'API مستخدم', grades: { 'api-prose': 3 } },
  { query: 'APIالمستخدمين', grades: { 'api-identifier': 3 } },
];

function discountedGain(grades: number[]): number {
  return grades.reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

describe('Arabic judged relevance', () => {
  it('meets recall and ranking quality thresholds', async () => {
    const index = await createDocIndex(docs, 'arabic');
    let recall = 0;
    let reciprocalRank = 0;
    let normalizedDiscountedGain = 0;

    for (const judgment of judgments) {
      const ids = (await searchDocs(index, judgment.query, { limit: 5 })).map((hit) => hit.id);
      const relevant = Object.keys(judgment.grades);
      recall += relevant.filter((id) => ids.includes(id)).length / relevant.length;
      const firstRelevant = ids.findIndex((id) => judgment.grades[id] !== undefined);
      reciprocalRank += firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);

      const actualGrades = ids.map((id) => judgment.grades[id] ?? 0);
      const idealGrades = Object.values(judgment.grades).sort((left, right) => right - left);
      normalizedDiscountedGain += discountedGain(actualGrades) / discountedGain(idealGrades);
    }

    const count = judgments.length;
    expect(recall / count).toBeGreaterThanOrEqual(0.95);
    expect(reciprocalRank / count).toBeGreaterThanOrEqual(0.95);
    expect(normalizedDiscountedGain / count).toBeGreaterThanOrEqual(0.9);
  });

  it.each([
    ['رياض', 'city'],
    ['قانون', 'laws'],
    ['برنامج', 'programming'],
    ['مستخدم', 'api-identifier'],
  ])('keeps the negative query %s away from %s', async (query, forbiddenId) => {
    const index = await createDocIndex(docs, 'arabic');
    expect((await searchDocs(index, query, { tolerance: 0 })).map((hit) => hit.id)).not.toContain(forbiddenId);
  });
});
