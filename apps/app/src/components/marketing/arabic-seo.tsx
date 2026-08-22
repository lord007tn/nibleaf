import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import { ArrowLeft, Check, ExternalLink, Languages, Search, Server, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { primaryButton } from '@/components/cloud-marketing';

const REVIEWED_ON = '22 أغسطس 2026';

interface Platform {
  name: string;
  href: string;
  summary: string;
  bestFor: string;
  arabic: string;
  model: string;
  caveat: string;
  nibleaf?: boolean;
}

const platforms: Platform[] = [
  {
    name: 'Nibleaf',
    href: '/ar',
    summary: 'محرر مرئي فوق Markdown، ونشر بإصدارات ثابتة، وبحث عربي، وخيار سحابي مجاني خلال المرحلة التجريبية أو استضافة كاملة من المصدر العام.',
    bestFor: 'الفِرق التي تريد الكتابة من المتصفح مع الاحتفاظ بـ Markdown، وتحتاج تجربة عربية وRTL داخل المحرر وموقع القارئ معًا.',
    arabic: 'واجهة عربية، واتجاه RTL، وشجرة مستقلة لكل لغة، وعزل للشيفرة داخل السطر، وبحث بتقطيع عربي وتطبيع إملائي محافظ.',
    model: 'سحابة مجانية خلال المرحلة التجريبية، أو نشر ذاتي للمنظومة الكاملة بترخيص AGPL-3.0.',
    caveat: 'لا يقدم حاليًا تحريرًا متزامنًا لحظيًا، ولا SAML/SCIM، ولا مساعد ذكاء اصطناعي مدمجًا.',
    nibleaf: true,
  },
  {
    name: 'Mintlify',
    href: 'https://www.mintlify.com/docs/guides/internationalization',
    summary: 'منصة مُدارة ومصقولة لوثائق المطورين، مع محرر ويب وأدوات قوية لمراجع API وميزات ذكاء اصطناعي.',
    bestFor: 'الفِرق التي تفضل خدمة مُدارة ناضجة وتحتاج مساعدًا ووكيلاً للذكاء الاصطناعي وتكاملات مؤسسية.',
    arabic: 'تدرج Mintlify العربية ضمن اللغات المدعومة وتحوّل تخطيط العربية والعبرية إلى RTL تلقائيًا عند ضبط اللغة.',
    model: 'Starter مجاني، وPro بسعر 450 دولارًا شهريًا، وEnterprise بسعر مخصص عند آخر مراجعة.',
    caveat:
      'المنصة الأساسية مُدارة ومغلقة المصدر؛ خيار Enterprise للاستضافة الذاتية يخص الواجهة المخصصة بينما تبقى خدمات المحتوى والبحث والذكاء الاصطناعي مُدارة.',
  },
  {
    name: 'GitBook',
    href: 'https://gitbook.com/docs/help-center/editing-content/writing-and-editing',
    summary: 'مساحة تحرير كتلية مُدارة مع مزامنة GitHub وGitLab، ومعاينات، وملعب API، وميزات بحث ومساعدة بالذكاء الاصطناعي في الخطط الأعلى.',
    bestFor: 'الفِرق التي تحتاج مزامنة GitLab ثنائية الاتجاه أو محتوى متكيفًا أو حوكمة مؤسسية ناضجة الآن.',
    arabic:
      'يذكر مركز المساعدة أن الفقرات والعناوين تكتشف RTL، لكن القوائم وكتل المحتوى الأخرى قد لا تُحاذى جيدًا، وأن مساهمات RTL ليست مدعومة بالكامل.',
    model: 'خطة مجانية لفرد واحد؛ Premium من 65 دولارًا للموقع و12 دولارًا للمستخدم شهريًا عند الفوترة السنوية.',
    caveat: 'يحتاج دعم العربية العملي إلى اختبار كل كتلة، لا الاكتفاء بفقرة عربية تبدو صحيحة.',
  },
  {
    name: 'Docusaurus',
    href: 'https://docusaurus.io/docs/i18n/introduction',
    summary: 'مولّد مواقع ثابتة مفتوح المصدر مبني على React، وله منظومة إضافات ناضجة وتحكم واسع في الواجهة والبناء.',
    bestFor: 'الفِرق الهندسية التي تريد docs-as-code وتحكمًا كاملاً ومستعدة لبناء تجربة التحرير والاستضافة والبحث بنفسها.',
    arabic: 'توثيقه الرسمي يذكر دعم RTL للعربية والعبرية وإصدار hreflang افتراضيًا ضمن نظام التدويل.',
    model: 'مفتوح المصدر بترخيص MIT؛ التكلفة هي الاستضافة ووقت التطوير والصيانة وخدمة البحث إن استُخدمت.',
    caveat: 'ليس منصة تحرير مرئي مُدارة؛ المترجمون والكتّاب غير التقنيين يحتاجون عادةً سير عمل Git وأدوات مراجعة إضافية.',
  },
  {
    name: 'Material for MkDocs',
    href: 'https://squidfunk.github.io/mkdocs-material/setup/changing-the-language/',
    summary: 'قالب قوي لمولد MkDocs، مناسب لمشاريع Python والفرق التي تريد موقعًا ثابتًا سريعًا بإعداد مفهوم.',
    bestFor: 'المشاريع التي تفضل Markdown وملف إعداد بسيطًا ولا تحتاج مساحة عمل تحريرية متكاملة.',
    arabic: 'العربية ضمن اللغات المدعومة؛ النهج الموصى به للمواقع متعددة اللغات هو مشروع فرعي لكل لغة مع مبدّل يربط بينها.',
    model: 'مفتوح المصدر، مع مسؤولية الفريق عن البناء والاستضافة وسير الترجمة.',
    caveat: 'تعدد اللغات موزع على مشاريع، وتظل تجربة التحرير والمراجعة والنشر مسؤولية الفريق.',
  },
  {
    name: 'Apidog',
    href: 'https://apidog.com/ar/blog/documentation-tools-ar/',
    summary: 'منصة لدورة حياة API تجمع التصميم والتصحيح والمحاكاة والاختبار وتوليد الوثائق التفاعلية، ولها مكتبة محتوى عربية نشطة.',
    bestFor: 'فرق API التي تريد أداة واحدة لتصميم الواجهة واختبارها ونشر مرجع تفاعلي، لا منصة عامة لوثائق المنتج فقط.',
    arabic: 'تملك صفحات ودروسًا عربية كثيرة، ما يمنحها حضورًا واضحًا في نتائج البحث العربية المتعلقة بتوثيق API والبدائل.',
    model: 'خدمة مُدارة بخطط متعددة؛ راجع صفحة السعر الرسمية قبل اتخاذ قرار لأن هذه المقارنة لا تنقل رقمًا لم نتحقق منه.',
    caveat: 'المقارنة مع Nibleaf جزئية: Apidog منصة دورة حياة API، بينما Nibleaf يركز على موقع وثائق المنتج والتحرير والنشر متعدد اللغات.',
  },
];

function ArabicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="border-border/70 border-b bg-muted/60 px-4 py-2 text-center text-muted-foreground text-xs">
        Nibleaf Cloud مجاني خلال المرحلة التجريبية، أو استضف المنظومة الكاملة من المصدر العام بترخيص AGPL-3.0.
      </div>
      <header className="sticky top-0 z-40 border-border/70 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a aria-label="الرئيسية العربية لـ Nibleaf" className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/ar">
            <NibleafMark aria-hidden="true" className="size-8" />
            <NibleafWordmark aria-hidden="true" />
          </a>
          <nav aria-label="التنقل العربي" className="ms-8 hidden items-center gap-6 text-muted-foreground text-sm md:flex">
            <a className="hover:text-foreground" href="/ar#features">
              المزايا
            </a>
            <a className="hover:text-foreground" href="/ar/documentation-platforms">
              مقارنة المنصات
            </a>
            <a className="hover:text-foreground" href="/blog/arabic-technical-documentation-rtl-checklist">
              دليل RTL
            </a>
            <a className="hover:text-foreground" href="https://docs.nibleaf.com">
              التوثيق
            </a>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <a className="hidden h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted sm:inline-flex" href="/" hrefLang="en">
              English
            </a>
            <a className={`${primaryButton} h-9 px-3 text-sm`} href="/sign-up">
              ابدأ مجانًا
            </a>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-border border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 text-sm sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <NibleafMark className="size-6" /> Nibleaf
            </div>
            <p className="mt-3 max-w-sm text-muted-foreground leading-relaxed">
              منصة توثيق بصرية فوق Markdown، صُممت للعربية وRTL من المحرر إلى البحث والموقع المنشور.
            </p>
          </div>
          <div>
            <p className="font-medium">روابط مفيدة</p>
            <div className="mt-3 grid gap-2 text-muted-foreground">
              <a className="hover:text-foreground" href="/pricing">
                الأسعار الحالية
              </a>
              <a className="hover:text-foreground" href="/self-hosting">
                دليل الاستضافة الذاتية
              </a>
              <a className="hover:text-foreground" href="/tools/rtl-documentation-readiness">
                أداة فحص جاهزية RTL
              </a>
            </div>
          </div>
          <div>
            <p className="font-medium">المصدر والشفافية</p>
            <div className="mt-3 grid gap-2 text-muted-foreground">
              <a
                className="inline-flex items-center gap-2 hover:text-foreground"
                href="https://github.com/lord007tn/nibleaf"
                rel="noopener noreferrer"
                target="_blank"
              >
                المستودع العام
              </a>
              <a className="hover:text-foreground" href="/about">
                عن Nibleaf ومنهج المقارنات
              </a>
              <a className="hover:text-foreground" href="/contact">
                تصحيح معلومة أو ترجمة
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function ArabicLandingPage() {
  return (
    <ArabicShell>
      <section className="relative overflow-hidden border-border border-b">
        <div
          className="absolute inset-0 -z-10 opacity-50"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'linear-gradient(to bottom, black, transparent 80%)',
          }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1fr_0.82fr] lg:py-28">
          <div>
            <p className="inline-flex rounded-full border border-border bg-card px-3 py-1 font-medium text-primary text-xs">
              منصة توثيق عربية وRTL فوق Markdown
            </p>
            <h1 className="mt-6 text-balance font-semibold text-5xl leading-[1.18] tracking-tight sm:text-6xl">
              اكتب وثائق المنتج بالعربية من دون أن تتنازل عن Markdown.
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground leading-8">
              Nibleaf يجمع محررًا بصريًا قريبًا من Notion، ومحتوى قابلًا للتصدير بصيغة Markdown، ونشرًا بإصدارات ثابتة، وبحثًا عربيًا، وشجرة صفحات مستقلة لكل
              لغة. استخدم السحابة مجانًا خلال المرحلة التجريبية أو شغّل المنظومة الكاملة على بنيتك.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className={`${primaryButton} group`} href="/sign-up">
                أنشئ حسابًا مجانيًا <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
              </a>
              <a
                className="inline-flex h-11 items-center rounded-md border border-border px-5 font-medium text-sm hover:bg-muted"
                href="/ar/documentation-platforms"
              >
                قارن منصات التوثيق
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground text-sm">
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> لا تحتاج بطاقة دفع
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> المحتوى يبقى Markdown
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> العربية وRTL من الأساس
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/5">
            <div className="flex items-center justify-between border-border border-b pb-4 text-sm">
              <span className="font-medium">صفحة عربية حقيقية</span>
              <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">العربية · RTL</span>
            </div>
            <div className="mt-6 space-y-5">
              <div>
                <p className="text-muted-foreground text-xs">العنوان</p>
                <p className="mt-1 font-semibold text-xl">ابدأ التكامل مع واجهة API</p>
              </div>
              <p className="text-muted-foreground leading-7">
                شغّل الأمر{' '}
                <code className="rounded bg-muted px-1.5 py-0.5" dir="ltr">
                  curl https://api.example.com/v1
                </code>{' '}
                ثم انسخ المفتاح إلى المتغير{' '}
                <code className="rounded bg-muted px-1.5 py-0.5" dir="ltr">
                  API_KEY
                </code>
                .
              </p>
              <div className="rounded-xl border border-border bg-background p-4" dir="ltr">
                <code>
                  curl -H "Authorization: Bearer $API_KEY" \<br />
                  &nbsp;&nbsp;https://api.example.com/v1/projects
                </code>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Search className="size-4" /> جرّب البحث: إعدادات · الاعدادات · للمستخدمين
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24" id="features">
        <div className="max-w-3xl">
          <p className="font-medium text-primary text-sm">العربية ليست ترجمة للواجهة فقط</p>
          <h2 className="mt-3 font-semibold text-4xl tracking-tight">اتجاه وكتابة وبحث ونشر في نظام واحد</h2>
          <p className="mt-5 text-lg text-muted-foreground leading-8">
            قد تعرض منصة ما فقرة عربية من اليمين إلى اليسار، لكن تجربة التوثيق الكاملة تشمل المحرر، وشجرة الصفحات، والتنقل، والشيفرة داخل النص، ونتائج
            البحث، ووسوم اللغة لمحركات البحث. صُممت هذه الطبقات معًا في Nibleaf.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            [Languages, 'لغة واتجاه', 'lang="ar" وdir="rtl" في الصفحة المنشورة، مع شجرة وعناوين تنقل خاصة بالعربية.'],
            [Search, 'بحث عربي', 'تقطيع عربي وتطبيع للتشكيل والتطويل وصور الألف، مع مسار صرفي خفيف ومعلن الحدود.'],
            [Server, 'سحابة أو استضافة ذاتية', 'نسخة سحابية مجانية خلال المرحلة التجريبية، أو Compose للمنظومة الكاملة من المصدر العام.'],
            [ShieldCheck, 'ملكية وشفافية', 'تصدير Markdown، وإصدارات نشر ثابتة، ومقارنات تذكر ما لا يقدمه المنتج بوضوح.'],
          ].map(([Icon, title, body]) => {
            const FeatureIcon = Icon as typeof Languages;
            return (
              <article className="rounded-xl border border-border bg-card p-6" key={title as string}>
                <FeatureIcon className="size-6 text-primary" />
                <h3 className="mt-5 font-semibold text-lg">{title as string}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-7">{body as string}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-border border-y bg-card/50">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <p className="font-medium text-primary text-sm">اختر على أساس سير العمل</p>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">متى يكون Nibleaf مناسبًا؟</h2>
            <ul className="mt-6 space-y-4 text-muted-foreground leading-7">
              {[
                'عندما يكتب المطورون والكتّاب ومديرو المنتج في المساحة نفسها، لكن يجب أن يبقى المحتوى Markdown قابلًا للنقل.',
                'عندما تحتاج العربية إلى تجربة كاملة في المحرر والقارئ والبحث، لا مجرد محاذاة فقرة.',
                'عندما تريد خيارًا مُدارًا اليوم مع مسار حقيقي للاستضافة الذاتية لاحقًا.',
                'عندما تفضّل نشرًا بإصدارات ثابتة ومعاينات ومراجعة GitHub على تعديل الموقع الحي مباشرة.',
              ].map((item) => (
                <li className="flex gap-3" key={item}>
                  <Check className="mt-1 size-5 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-primary text-sm">اختر المنافس عندما يناسبك أكثر</p>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">متى لا يكون Nibleaf الخيار الأفضل؟</h2>
            <ul className="mt-6 space-y-4 text-muted-foreground leading-7">
              {[
                'اختر Mintlify إذا كانت ميزات الوكيل والمساعد بالذكاء الاصطناعي والتكاملات المُدارة أولوية فورية.',
                'اختر GitBook إذا كنت تحتاج مزامنة GitLab ثنائية الاتجاه أو المحتوى المتكيف أو SAML اليوم.',
                'اختر Docusaurus أو Material for MkDocs إذا كان فريقك هندسيًا بالكامل ويريد موقعًا ثابتًا يتحكم بكل سطر في بنائه.',
                'اختر Apidog إذا كانت حاجتك الأساسية إدارة دورة حياة API من التصميم والاختبار إلى المحاكاة والتوثيق.',
              ].map((item) => (
                <li className="flex gap-3" key={item}>
                  <Check className="mt-1 size-5 shrink-0 text-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-balance font-semibold text-4xl tracking-tight">ابدأ بصفحة عربية واحدة واختبرها جيدًا</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground leading-8">
          أنشئ صفحة، واخلط فيها العربية مع أمر ومسار وجدول، ثم اختبرها على الهاتف وفي البحث قبل نقل بقية المحتوى. أداة Nibleaf المجانية تفحص HTML
          محليًا في متصفحك ولا ترفع الملف إلى خادمنا.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a className={primaryButton} href="/tools/rtl-documentation-readiness">
            افحص جاهزية RTL
          </a>
          <a
            className="inline-flex h-11 items-center rounded-md border border-border px-5 font-medium text-sm hover:bg-muted"
            href="/blog/arabic-technical-documentation-rtl-checklist"
          >
            اقرأ قائمة الفحص
          </a>
        </div>
      </section>
    </ArabicShell>
  );
}

export function ArabicDocumentationPlatformsPage() {
  return (
    <ArabicShell>
      <article>
        <header className="border-border border-b">
          <div className="mx-auto max-w-4xl px-6 py-20">
            <p className="font-medium text-primary text-sm">دليل شراء ومقارنة مستقلة المصادر</p>
            <h1 className="mt-4 text-balance font-semibold text-4xl leading-tight tracking-tight sm:text-5xl">
              أفضل منصات التوثيق للفرق العربية: مقارنة RTL وMarkdown والاستضافة
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-8">
              لا توجد منصة واحدة أفضل للجميع. Nibleaf مناسب لفريق يريد محررًا بصريًا فوق Markdown ودعمًا عربيًا كاملاً وخيار استضافة ذاتية. Mintlify أقوى
              في الذكاء الاصطناعي المُدار، وGitBook ناضج في التعاون المؤسسي، وDocusaurus وMaterial for MkDocs يمنحان الفريق الهندسي تحكمًا واسعًا،
              وApidog يتفوق عندما تكون دورة حياة API هي المشكلة الأساسية.
            </p>
            <p className="mt-5 border-border border-t pt-5 text-muted-foreground text-sm leading-7">
              الإفصاح: نحن نبني Nibleaf، لذلك لنا مصلحة تجارية واضحة. راجعنا المصادر الرسمية لكل منافس في {REVIEWED_ON}، وربطناها مباشرة، وذكرنا
              الحالات التي يكون فيها المنافس اختيارًا أفضل. الأسعار والميزات تتغير؛ افحص المصدر قبل الشراء.
            </p>
          </div>
        </header>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">كيف أجرينا المقارنة؟</h2>
          <p className="mt-5 text-muted-foreground leading-8">
            قارنّا ستة خيارات تخدم نوايا مختلفة: منصة توثيق مُدارة، ومساحة تحرير تعاونية، ومولدات مواقع ثابتة، ومنصة دورة حياة API. لم نعامل ظهور كلمة
            «العربية» في قائمة اللغات على أنه دليل كافٍ. بحثنا عن اتجاه الصفحة، وسلوك كتل المحتوى، وبنية اللغات، ووسوم hreflang، وسير التحرير، وملكية
            Markdown، ونموذج الاستضافة، والسعر المنشور. لم نختبر حسابًا مدفوعًا لدى كل منافس؛ عندما اعتمدنا على التوثيق الرسمي نقول ذلك صراحة.
          </p>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">ملخص مقارنة منصات التوثيق للفرق العربية</caption>
              <thead>
                <tr className="border-border border-b bg-muted/50">
                  <th className="px-4 py-3 text-start">المنصة</th>
                  <th className="px-4 py-3 text-start">الأنسب لـ</th>
                  <th className="px-4 py-3 text-start">حالة العربية وRTL</th>
                  <th className="px-4 py-3 text-start">نموذج التشغيل</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((platform) => (
                  <tr className="border-border border-b align-top last:border-0" key={platform.name}>
                    <th className="px-4 py-4 text-start font-medium">{platform.name}</th>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.bestFor}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.arabic}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border border-y bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="font-semibold text-3xl tracking-tight">الخيارات الستة، بلا إخفاء للمقايضات</h2>
            <div className="mt-10 space-y-6">
              {platforms.map((platform, index) => (
                <section
                  className={`rounded-xl border bg-background p-7 ${platform.nibleaf ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}
                  key={platform.name}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-muted-foreground/50">{String(index + 1).padStart(2, '0')}</span>
                    <h3 className="font-semibold text-xl">{platform.name}</h3>
                    {platform.nibleaf ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-primary-foreground text-xs">منتجنا</span>
                    ) : (
                      <a
                        className="inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-2"
                        href={platform.href}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        المصدر الرسمي <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <p className="mt-4 text-muted-foreground leading-8">{platform.summary}</p>
                  <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-medium">اختره عندما</dt>
                      <dd className="mt-1 text-muted-foreground leading-7">{platform.bestFor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">انتبه إلى</dt>
                      <dd className="mt-1 text-muted-foreground leading-7">{platform.caveat}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">كيف تختار منصة توثيق عربية؟</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {[
              ['اختبر سطرًا مختلطًا', 'اكتب جملة عربية فيها أمر CLI ومسار ورقم إصدار. يجب أن تبقى الشيفرة LTR وقابلة للنسخ، بينما تظل الجملة RTL.'],
              [
                'اختبر أكثر من فقرة',
                'راجع القوائم والجداول والتنبيهات والتنقل و«السابق/التالي» والبحث على الهاتف. نجاح الفقرات وحدها لا يعني نجاح RTL.',
              ],
              [
                'افصل التحرير عن القراءة',
                'قد يكون الموقع المنشور جيدًا بينما يظل المحرر أو التعليقات أو شجرة الصفحات صعبة بالعربية. اختبر دورة العمل كاملة.',
              ],
              ['راجع ملكية المحتوى', 'اسأل أين يعيش المصدر، وكيف تصدّره، وما الذي يحدث للروابط والوسائط والمكونات إن قررت المغادرة.'],
              ['قارن التكلفة الكاملة', 'السعر ليس الاشتراك فقط: أضف المقاعد، والبحث، والترجمة، والاستضافة، والنسخ الاحتياطي، ووقت الصيانة.'],
              ['انشر تدريجيًا', 'ابدأ بالبدء السريع والتثبيت وحل الأخطاء الأكثر شيوعًا. عشر صفحات مراجعة أفضل من خمسين ترجمة آلية قديمة.'],
            ].map(([title, body]) => (
              <div className="rounded-xl border border-border bg-card p-6" key={title}>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-7">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-border border-y bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="font-semibold text-3xl tracking-tight">توصية سريعة حسب نوع الفريق</h2>
            <div className="mt-8 space-y-5 text-muted-foreground leading-8">
              <p>
                <strong className="text-foreground">فريق منتج عربي متعدد التخصصات:</strong> ابدأ بـ Nibleaf إذا كانت أولوية الفريق محررًا بصريًا
                وMarkdown ودعم RTL في دورة العمل كاملة. جرّب صفحة فعلية قبل نقل المحتوى.
              </p>
              <p>
                <strong className="text-foreground">فريق يحتاج AI مُدارًا الآن:</strong> Mintlify هو المرشح الأقوى في هذه المجموعة، لكن راجع سعر Pro
                وحدود الاعتمادات وخيار الاستضافة المؤسسي كما تصفه الشركة.
              </p>
              <p>
                <strong className="text-foreground">مؤسسة تعتمد GitLab والمحتوى المتكيف:</strong> GitBook يقدم سيرًا ناضجًا، لكن وثائقه نفسها تحذر من أن
                مساهمات RTL ليست كاملة؛ نفّذ تجربة عربية قبل العقد.
              </p>
              <p>
                <strong className="text-foreground">فريق هندسي يحب Git والبناء:</strong> Docusaurus أو Material for MkDocs خياران منطقيان. ستحصل على
                تحكم وملكية، مقابل أن تبني الاستضافة والبحث والمراجعة والتحرير بنفسك.
              </p>
              <p>
                <strong className="text-foreground">فريق API أولاً:</strong> Apidog مناسب عندما تحتاج التصميم والمحاكاة والاختبار والتوثيق في منتج
                واحد. أما إن كان OpenAPI جزءًا من موقع وثائق منتج أوسع، فقارن بينه وبين مرجع Scalar المدمج في Nibleaf.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">أسئلة شائعة</h2>
          <div className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
            {[
              [
                'ما أفضل بديل عربي لـ Mintlify؟',
                'يعتمد على سبب المغادرة. Nibleaf مناسب للاستضافة الكاملة وMarkdown والتحرير العربي. Docusaurus وMaterial for MkDocs مناسبان لفريق هندسي يريد مولدًا ثابتًا. Apidog مناسب أكثر لدورة حياة API. لا يوجد بديل واحد يكرر كل ميزات Mintlify.',
              ],
              [
                'هل Mintlify يدعم العربية وRTL؟',
                'نعم، توثيقه الرسمي يدرج العربية ويقول إن التخطيط يتحول إلى RTL عند ضبط اللغة. مع ذلك، اختبر الجداول والتنقل والشيفرة داخل النص في مشروعك، لأن دعم اللغة في الإعداد لا يثبت كل حالة عرض.',
              ],
              [
                'هل GitBook يدعم RTL بالكامل؟',
                'لا وفق صياغة مركز المساعدة الحالي. GitBook يذكر أن الفقرات والعناوين تكتشف RTL، لكنه يحذر من أن القوائم وكتلًا أخرى قد لا تُحاذى جيدًا وأن مساهمات RTL غير مدعومة بالكامل.',
              ],
              [
                'هل الاستضافة الذاتية أرخص دائمًا؟',
                'لا. قد يلغي البرنامج رسوم الترخيص لكنه ينقل إليك DNS وTLS وقاعدة البيانات والتخزين والنسخ الاحتياطي والمراقبة والترقية والاستعادة. احسب وقت التشغيل والمخاطر، لا سعر الخادم فقط.',
              ],
              [
                'هل يجب ترجمة كل الوثائق قبل إطلاق العربية؟',
                'لا. ابدأ بالصفحات التي تحل أول مشكلة للقارئ: البدء السريع والتثبيت والمصادقة والأخطاء الشائعة. اربط الترجمات المتقابلة بـ hreflang، وانشر بقية الصفحات عندما تراجعها.',
              ],
            ].map(([question, answer]) => (
              <details className="group px-6 py-1 open:bg-muted/30" key={question}>
                <summary className="flex list-none items-center justify-between gap-4 py-5 font-medium">
                  {question}
                  <span className="grid size-6 place-items-center rounded-full border border-border transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-5 text-muted-foreground text-sm leading-7">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-2xl bg-foreground px-8 py-14 text-center text-background">
            <h2 className="font-semibold text-3xl tracking-tight">اختبر قرارك على محتوى عربي حقيقي</h2>
            <p className="mx-auto mt-4 max-w-2xl text-background/75 leading-7">
              أنشئ مشروعًا مجانيًا في Nibleaf، وانشر صفحة اختبار مختلطة الاتجاه، ثم قارنها بالمنصة التي تستخدمها اليوم. لا تحتاج بطاقة دفع.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={`${primaryButton} group`} href="/sign-up">
                ابدأ مجانًا <ArrowLeft className="size-4" />
              </a>
              <a
                className="inline-flex h-11 items-center rounded-md border border-background/30 px-5 font-medium text-sm hover:bg-background/10"
                href="/tools/rtl-documentation-readiness"
              >
                افحص HTML موجودًا
              </a>
            </div>
          </div>
        </section>
      </article>
    </ArabicShell>
  );
}
