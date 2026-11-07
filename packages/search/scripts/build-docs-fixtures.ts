import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatHistoryMessage } from '../src/answer-chat';
export interface Fixture {
  id: string;
  language: string;
  question: string;
  history?: ChatHistoryMessage[];
  sources: { title: string; path: string; heading: string; content: string }[];
  requiredClaims: string[];
  forbiddenClaims?: string[];
  expectedNoAnswer: boolean;
  expectedSourceHeadings?: string[];
  expectClarifying?: boolean;
  rewriteTopicTerms?: string[];
  pageContext?: { title: string; path: string };
}
type Intent = {
  id: string;
  language: string;
  question: string;
  doc: string;
  heading: string;
  claims?: string[];
  noAnswer?: boolean;
  clarify?: boolean;
  prior?: string;
  topic?: string[];
  forbidden?: string[];
};
const cases: Intent[] = [
  {
    id: 'publish',
    language: 'en',
    question: 'Walk me through publishing the pages I have finished.',
    doc: 'product/publishing',
    heading: 'Publish',
    claims: ['Publish'],
  },
  {
    id: 'ar-search-follow',
    language: 'ar',
    question: 'طيب، هل يلاقي الكلمات حتى لو كتبتها بدون تشكيل؟',
    prior: 'هل يدعم بحث نيبليف المحتوى العربي؟',
    doc: 'ar/product/arabic-rtl',
    heading: 'تحقّق من البحث بالعربية',
    claims: ['تشكيل'],
    topic: ['بحث', 'عرب'],
  },
  {
    id: 'mixed-vague',
    language: 'mixed',
    question: 'أبغى أغير شكل موقع التوثيق، أي theme أختار؟',
    doc: 'ar/product/themes',
    heading: 'اختر سمة',
    clarify: true,
  },
  {
    id: 'weather',
    language: 'en',
    question: 'Will it rain in Berlin tomorrow?',
    doc: 'product/publishing',
    heading: 'Publish',
    noAnswer: true,
  },
  {
    id: 'reader-check',
    language: 'en',
    question: 'How do I check that visitors can actually read my new pages?',
    doc: 'product/publishing',
    heading: 'Check what readers see',
    claims: ['404'],
  },
  {
    id: 'recover',
    language: 'en',
    question: 'Publishing failed. Will my old pages disappear, and what should I do?',
    doc: 'product/publishing',
    heading: 'If publishing is blocked or fails',
    claims: ['publish'],
    forbidden: ['delete the previous'],
  },
  {
    id: 'custom-domain',
    language: 'en',
    question: 'When can I put my docs on my own domain?',
    doc: 'product/custom-domains',
    heading: 'Before you start',
    claims: ['default', 'domain'],
  },
  {
    id: 'move-follow',
    language: 'en',
    question: 'What should I do with the old link after moving it?',
    prior: 'I am reorganizing a published documentation page.',
    doc: 'product/authoring',
    heading: 'Change page details',
    claims: ['redirect'],
    topic: ['page', 'redirect'],
  },
  {
    id: 'review',
    language: 'en',
    question: 'How can my team review a big rewrite before it goes live? Give me the steps.',
    doc: 'product/authoring',
    heading: 'Review a change with your team',
    claims: ['Comment', 'Preview'],
  },
  {
    id: 'ar-en',
    language: 'en',
    question: 'Can people search my Arabic docs without typing accents?',
    doc: 'product/arabic-rtl',
    heading: 'Check Arabic search',
    claims: ['diacritics'],
  },
  {
    id: 'translation',
    language: 'en',
    question: 'Do my English and Arabic pages have to have the same address?',
    doc: 'product/arabic-rtl',
    heading: 'Link translated pages',
    claims: ['hreflang'],
  },
  {
    id: 'en-vague',
    language: 'en',
    question: 'I want my docs to look different. Which one should I pick?',
    doc: 'product/themes',
    heading: 'Pick a theme',
    clarify: true,
  },
  {
    id: 'export',
    language: 'en',
    question: 'How do I download a copy of my docs?',
    doc: 'product/exports',
    heading: 'Create a one-time export',
    claims: ['export'],
  },
  {
    id: 'tax',
    language: 'en',
    question: 'How much income tax do I owe this year?',
    doc: 'product/exports',
    heading: 'Create a one-time export',
    noAnswer: true,
  },
  {
    id: 'ar-publish',
    language: 'ar',
    question: 'خلصت كتابة الصفحات، كيف أنشرها للناس خطوة بخطوة؟',
    doc: 'ar/product/publishing',
    heading: 'انشر',
    claims: ['نشر'],
  },
  {
    id: 'ar-check',
    language: 'ar',
    question: 'كيف أتأكد أن الزائر يقدر يشوف الصفحات الجديدة؟',
    doc: 'ar/product/publishing',
    heading: 'تحقّق مما يراه القرّاء',
    claims: ['404'],
  },
  {
    id: 'ar-recover-follow',
    language: 'ar',
    question: 'طيب لو فشل، إيش أسوي؟',
    prior: 'أريد نشر النسخة الجديدة من التوثيق.',
    doc: 'ar/product/publishing',
    heading: 'إذا تعذّر النشر أو فشل',
    topic: ['نشر', 'توثيق'],
  },
  {
    id: 'ar-mode',
    language: 'ar',
    question: 'أنا مو مبرمج، هل أقدر أكتب صفحة من غير كتابة أكواد؟',
    doc: 'ar/product/authoring',
    heading: 'اكتب صفحة',
    claims: ['Markdown'],
  },
  {
    id: 'ar-language',
    language: 'ar',
    question: 'كيف أضيف نسخة عربية للموقع؟',
    doc: 'ar/product/arabic-rtl',
    heading: 'أضف لغة',
    claims: ['rtl'],
  },
  {
    id: 'ar-translation',
    language: 'ar',
    question: 'هل لازم رابط الصفحة العربية يكون مثل الإنجليزية؟',
    doc: 'ar/product/arabic-rtl',
    heading: 'اربط الصفحات المترجمة',
    claims: ['hreflang'],
  },
  { id: 'ar-export', language: 'ar', question: 'كيف أنزّل نسخة من التوثيق عندي؟', doc: 'ar/product/exports', heading: 'أنشئ تصديرًا لمرة واحدة' },
  {
    id: 'ar-vague',
    language: 'ar',
    question: 'أبغى شكل ثاني لموقع التوثيق، أي واحد أنسب لي؟',
    doc: 'ar/product/themes',
    heading: 'اختر سمة',
    clarify: true,
  },
  {
    id: 'ar-review',
    language: 'ar',
    question: 'كيف أراجع تعديلات الفريق قبل نشرها؟ اشرح الخطوات.',
    doc: 'ar/product/authoring',
    heading: 'راجع التغيير مع فريقك',
  },
  {
    id: 'ar-food',
    language: 'ar',
    question: 'كيف أطبخ كبسة دجاج لأربعة أشخاص؟',
    doc: 'ar/product/authoring',
    heading: 'اكتب صفحة',
    noAnswer: true,
  },
  {
    id: 'ar-health',
    language: 'ar',
    question: 'عندي صداع، أي دواء آخذ؟',
    doc: 'ar/product/exports',
    heading: 'أنشئ تصديرًا لمرة واحدة',
    noAnswer: true,
  },
  {
    id: 'mixed-publish',
    language: 'mixed',
    question: 'كيف أسوي Publish للصفحات اللي خلصتها؟',
    doc: 'ar/product/publishing',
    heading: 'انشر',
  },
  {
    id: 'mixed-preview',
    language: 'mixed',
    question: 'كيف أراجع الصفحة في Preview قبل ما أنشرها؟',
    doc: 'ar/product/authoring',
    heading: 'راجع التغيير مع فريقك',
    claims: ['Preview'],
  },
  {
    id: 'mixed-translation-follow',
    language: 'mixed',
    question: 'وهل لازم الـ slug يكون نفسه؟',
    prior: 'أريد ربط الصفحة العربية بترجمتها الإنجليزية في Nibleaf.',
    doc: 'ar/product/arabic-rtl',
    heading: 'اربط الصفحات المترجمة',
    claims: ['hreflang'],
    topic: ['ترجم', 'عرب', 'slug'],
  },
  {
    id: 'mixed-search',
    language: 'mixed',
    question: 'هل Arabic search يتعامل مع اختلاف التشكيل؟',
    doc: 'ar/product/arabic-rtl',
    heading: 'تحقّق من البحث بالعربية',
  },
  {
    id: 'mixed-rtl',
    language: 'mixed',
    question: 'كيف أخلي النسخة العربية RTL؟',
    doc: 'ar/product/arabic-rtl',
    heading: 'أضف لغة',
    claims: ['rtl'],
  },
  {
    id: 'mixed-move-follow',
    language: 'mixed',
    question: 'والـ old URL كيف أخليه يودّي للمكان الجديد؟',
    prior: 'سأنقل صفحة توثيق منشورة إلى مجموعة أخرى.',
    doc: 'ar/product/authoring',
    heading: 'غيّر تفاصيل الصفحة',
    topic: ['صفحة', 'رابط', 'تحويل'],
  },
  {
    id: 'mixed-api-key',
    language: 'mixed',
    question: 'وين أحط API key عشان أشغّل Smart AI للموقع؟',
    doc: 'ar/self-hosting/search-ai',
    heading: 'إعداد المزوّدين',
  },
  {
    id: 'mixed-export-follow',
    language: 'mixed',
    question: 'وكيف أعمله مرة واحدة؟',
    prior: 'أحتاج export من صفحات التوثيق للاحتفاظ بنسخة.',
    doc: 'ar/product/exports',
    heading: 'أنشئ تصديرًا لمرة واحدة',
    topic: ['تصدير', 'export'],
  },
  {
    id: 'mixed-chat',
    language: 'mixed',
    question: 'كيف القارئ يفتح AI chat ويسأل عن الصفحة؟',
    doc: 'ar/self-hosting/search-ai',
    heading: 'تشغيل مساعد المحادثة بالذكاء الاصطناعي',
    claims: ['Ask AI'],
  },
  {
    id: 'mixed-football',
    language: 'mixed',
    question: 'مين فاز في Champions League أمس؟',
    doc: 'ar/product/publishing',
    heading: 'انشر',
    noAnswer: true,
  },
  {
    id: 'mixed-stocks',
    language: 'mixed',
    question: 'هل أشتري أسهم Apple اليوم؟',
    doc: 'ar/product/exports',
    heading: 'أنشئ تصديرًا لمرة واحدة',
    noAnswer: true,
  },
];
const here = dirname(fileURLToPath(import.meta.url));
async function section(doc: string, heading: string) {
  const text = await readFile(resolve(here, '../../../docs', `${doc}.mdx`), 'utf8');
  const title = text.match(/^title:\s*['"]?(.*?)['"]?\r?$/m)?.[1] ?? doc;
  // Ignore headings inside fenced code; include subordinate headings until the next peer.
  const lines = text.split(/\r?\n/);
  let fence = false;
  let start = -1;
  let level = 0;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    if (start < 0 && match[2] === heading) {
      start = i;
      level = match[1]?.length ?? 2;
    } else if (start >= 0 && (match[1]?.length ?? 7) <= level) {
      end = i;
      break;
    }
  }
  if (start < 0) throw new Error(`Missing heading ${doc}: ${heading}`);
  const content = lines.slice(start, end).join('\n').trim();
  return { title, path: doc, heading, content: content.slice(0, 1800).trim() };
}
const fixtures: Fixture[] = [];
for (const c of cases) {
  const arabic = c.language !== 'en';
  const distractors = arabic
    ? [
        ['ar/product/exports', 'جدوِل أرشفة منتظمة'],
        ['ar/product/publishing', 'راجع صفحاتك أولًا'],
        ['ar/product/arabic-rtl', 'تحقّق من النص العربي والإنجليزي المختلط'],
      ]
    : [
        ['product/exports', 'Schedule regular archives'],
        ['product/publishing', 'Check your pages first'],
        ['product/arabic-rtl', 'Check mixed Arabic and English text'],
      ];
  const sources = await Promise.all([[c.doc, c.heading], ...distractors].map(([doc, heading]) => section(doc as string, heading as string)));
  // Rotate evidence position so S1 is not a shortcut to citation accuracy.
  const rotate = fixtures.length % sources.length;
  sources.push(...sources.splice(0, rotate));
  fixtures.push({
    id: c.id,
    language: c.language,
    question: c.question,
    sources,
    requiredClaims: c.claims ?? [],
    expectedNoAnswer: c.noAnswer ?? false,
    expectedSourceHeadings: c.noAnswer ? [] : [c.heading],
    ...(c.clarify ? { expectClarifying: true } : {}),
    ...(c.forbidden ? { forbiddenClaims: c.forbidden } : {}),
    ...(c.prior
      ? {
          history: [
            { role: 'user', content: c.prior },
            { role: 'assistant', content: arabic ? 'ما الذي تريد معرفته بالتحديد؟' : 'What would you like to know about that?' },
          ],
          rewriteTopicTerms: c.topic,
        }
      : {}),
  });
}
await writeFile(resolve(here, '../eval/nibleaf-docs-fixtures.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(
  JSON.stringify({
    cases: fixtures.length,
    languages: Object.fromEntries(['en', 'ar', 'mixed'].map((l) => [l, fixtures.filter((f) => f.language === l).length])),
    followUps: fixtures.filter((f) => f.history).length,
    noAnswer: fixtures.filter((f) => f.expectedNoAnswer).length,
    clarifying: fixtures.filter((f) => f.expectClarifying).length,
  }),
);
