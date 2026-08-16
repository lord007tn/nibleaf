const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const PURE_ARABIC_WORD = /^[\u0621-\u063a\u0641-\u064a]+$/u;
const CONTAINS_ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const SEARCH_TOKEN = /[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu;
const MARKDOWN_CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

/**
 * Words for which a superficially valid affix removal is substantially more
 * likely to change meaning than reveal an inflection. Arabic has no casing to
 * identify names, so the list also covers common names and place names that
 * otherwise resemble prefixed words.
 */
const PROTECTED_WORDS = new Set([
  'الله',
  'الان',
  'الذي',
  'الذين',
  'التي',
  'اللاتي',
  'اللواتي',
  'المدينة',
  'احمد',
  'ابراهيم',
  'اسماعيل',
  'الاردن',
  'الرياض',
  'امتحان',
  'انسان',
  'براهين',
  'جدة',
  'حيوان',
  'دبي',
  'رمضان',
  'رياض',
  'سكاكين',
  'سوريا',
  'شياطين',
  'عائشة',
  'عمان',
  'عناوين',
  'فاطمة',
  'فلسطين',
  'قوانين',
  'لبنان',
  'محمد',
  'محمود',
  'مريم',
  'مصر',
  'مهرجان',
  'ميدان',
  'ميادين',
  'مكة',
  'هناك',
  'هؤلاء',
  'ولكن',
  'يوسف',
  'ياسين',
]);

/** High-value documentation terms whose sound plural cannot be inferred from
 * the final letters alone without colliding with another common Arabic word. */
const IRREGULAR_DOCUMENTATION_FORMS = new Map<string, string>([
  ['اعدادات', 'اعداد'],
  ['اتصالات', 'اتصال'],
  ['اختبارات', 'اختبار'],
  ['اشعارات', 'اشعار'],
  ['اصدارات', 'اصدار'],
  ['بيانات', 'بيان'],
  ['تحديثات', 'تحديث'],
  ['تطبيقات', 'تطبيق'],
  ['تعريفات', 'تعريف'],
  ['تعليقات', 'تعليق'],
  ['تنبيهات', 'تنبيه'],
  ['حسابات', 'حساب'],
  ['خيارات', 'خيار'],
  ['شبكات', 'شبكة'],
  ['شركات', 'شركة'],
  ['شاشات', 'شاشة'],
  ['صفحات', 'صفحة'],
  ['طلبات', 'طلب'],
  ['فئات', 'فئة'],
  ['خدمات', 'خدمة'],
  ['كلمات', 'كلمة'],
  ['لغات', 'لغة'],
  ['مكونات', 'مكون'],
  ['مكتبات', 'مكتبة'],
  ['ملفات', 'ملف'],
  ['متطلبات', 'متطلب'],
  ['متغيرات', 'متغير'],
  ['مستندات', 'مستند'],
  ['منصات', 'منصة'],
  ['نطاقات', 'نطاق'],
  ['واجهات', 'واجهة'],
  ['وحدات', 'وحدة'],
]);

const PREFIXES = ['وبال', 'فبال', 'وكال', 'فكال', 'وال', 'فال', 'بال', 'كال', 'ولل', 'فلل', 'لل', 'ال'] as const;
const PRONOUN_SUFFIXES = ['كما', 'هما', 'كم', 'كن', 'نا', 'ها', 'هم', 'هن'] as const;

/** Conservative Arabic spelling normalization shared by exact and
 * morphological indexing/query paths. Ta marbuta deliberately remains distinct
 * from ha. */
export const normalizeArabicSearchText = (value: string): string =>
  value
    .replace(ARABIC_DIACRITICS, '')
    .replace(/\u0640/g, '')
    .replace(ARABIC_ALEF_VARIANTS, '\u0627')
    .replace(/\u0649/g, '\u064a');

function removePrefix(word: string): string {
  for (const prefix of PREFIXES) {
    if (!word.startsWith(prefix)) {
      continue;
    }
    const remainder = word.slice(prefix.length);
    if (remainder.length >= 4 && !PROTECTED_WORDS.has(remainder)) {
      return remainder;
    }
    return word;
  }

  // Bare conjunctions are much more ambiguous than article/preposition
  // compounds. Only detach them from a long word (e.g. ومستخدمون), which
  // protects common short lexical words such as وثائق and واجهة.
  if ((word.startsWith('و') || word.startsWith('ف')) && word.length >= 7) {
    const remainder = word.slice(1);
    if (!PROTECTED_WORDS.has(remainder)) {
      return remainder;
    }
  }

  // Bare ب/ك/ل are extremely ambiguous inside lexical words. Limit their
  // detachment to long م-prefixed documentation nouns (لمستخدمين، كمطورين),
  // while the common article compounds above remain fully supported.
  if ((word.startsWith('ب') || word.startsWith('ك') || word.startsWith('ل')) && word.length >= 7) {
    const remainder = word.slice(1);
    if (remainder.startsWith('م') && !PROTECTED_WORDS.has(remainder)) {
      return remainder;
    }
  }
  return word;
}

function removePronounSuffix(word: string): string {
  for (const suffix of PRONOUN_SUFFIXES) {
    if (!word.endsWith(suffix)) {
      continue;
    }
    const remainder = word.slice(0, -suffix.length);
    return remainder.length >= 4 ? remainder : word;
  }
  return word;
}

function normalizeNominalSuffix(word: string): string {
  const irregular = IRREGULAR_DOCUMENTATION_FORMS.get(word);
  if (irregular) {
    return irregular;
  }

  if (word.endsWith('تين') || word.endsWith('تان')) {
    const remainder = word.slice(0, -3);
    return remainder.length >= 4 ? `${remainder}ة` : word;
  }

  if (word.endsWith('ات')) {
    const remainder = word.slice(0, -2);
    if (remainder.length < 4) {
      return word;
    }
    // The safe default for ـات is the corresponding feminine form. Common
    // non-feminine documentation plurals are handled explicitly above.
    return `${remainder}ة`;
  }

  if (word.endsWith('ون') || word.endsWith('ين') || word.endsWith('ان')) {
    const remainder = word.slice(0, -2);
    return remainder.length >= 4 ? remainder : word;
  }
  return word;
}

/**
 * Return one deterministic light stem for an Arabic prose token. This is not a
 * root extractor: at most one prefix, one attached pronoun, and one nominal
 * inflection are removed. Original normalized tokens live in separate index
 * fields, so this stem can only add recall.
 */
export function lightStemArabicToken(token: string): string {
  const normalized = normalizeArabicSearchText(token);
  if (normalized.length < 5 || !PURE_ARABIC_WORD.test(normalized) || PROTECTED_WORDS.has(normalized)) {
    return normalized;
  }

  const withoutPrefix = removePrefix(normalized);
  if (withoutPrefix !== normalized && PROTECTED_WORDS.has(withoutPrefix)) {
    return normalized;
  }
  const withoutPronoun = removePronounSuffix(withoutPrefix);
  const stem = normalizeNominalSuffix(withoutPronoun);
  return stem.length >= 4 ? stem : normalized;
}

function analyzeProseSegment(value: string): string {
  return value.replace(SEARCH_TOKEN, (token) => {
    if (PURE_ARABIC_WORD.test(token)) {
      return lightStemArabicToken(token);
    }
    // Orama splits scripts inside a token. Omit mixed Arabic/Latin, versioned,
    // path-like, and identifier-shaped tokens from morphology fields so their
    // Arabic fragment cannot be stemmed accidentally. Exact fields retain them.
    return CONTAINS_ARABIC.test(token) ? ' ' : token;
  });
}

/**
 * Apply the exact same bounded morphological analysis to indexed Arabic prose
 * and Arabic queries. Markdown code spans/fences and mixed-script identifiers
 * are omitted from morphology fields; the separate exact fields retain them.
 */
export function normalizeArabicMorphologyText(value: string): string {
  const normalized = normalizeArabicSearchText(value);
  return normalized
    .split(MARKDOWN_CODE)
    .map((part, index) => (index % 2 === 1 ? ' ' : analyzeProseSegment(part)))
    .join('');
}
