#!/usr/bin/env node
/**
 * Dependency-free mock of the public site API used by the published-docs reader.
 *
 * Serves a bilingual (en + ar/RTL) documentation site for four mock project ids
 * so the reader (apps/app, port 4310) can be exercised without Docker, Postgres,
 * or the real API:
 *
 *   preview-harbor      theme preset "harbor"
 *   preview-manuscript  theme preset "manuscript"
 *   preview-signal      theme preset "signal"
 *   preview-legacy      no `theme` config (legacy palette branch)
 *
 * Endpoints (mirroring apps/server/src/modules/public/sites/handlers.ts):
 *   GET  /api/public/sites/:id?lang=&version=            -> { data: SiteShell }
 *   GET  /api/public/sites/:id/page?path=&lang=&version= -> { data: SitePage } (404 JSON for unknown paths)
 *   GET  /api/public/sites/:id/search                    -> { data: { hits: [] } }
 *   GET  /api/public/sites/:id/changelog                 -> { data: [] }
 *   GET  /api/public/assets/*                            -> a generated SVG (the sample image)
 *   ANY  /api/**                                         -> 204 (events, analytics, anything else)
 *
 * Usage: node scripts/site-preview-mock.mjs [--port 4311]
 * Then:  cd apps/app && pnpm dev   # proxies /api/** to http://localhost:4311
 *        open http://localhost:4310/sites/preview-harbor?lang=ar
 */
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const PORT = Number(portFlag === -1 ? (process.env.PORT ?? 4311) : args[portFlag + 1]) || 4311;

const GENERATED_AT = '2026-09-01T09:00:00.000Z';
const VERSIONS = [{ id: 'ver_latest', name: 'Latest', slug: 'latest', isDefault: true }];
const LANGUAGES = [
  { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true },
  { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true },
];

// ─── Sample image (served under /api/public/assets so the dev proxy routes it) ─

const DIAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 420" width="960" height="420" font-family="Segoe UI, Noto Sans Arabic, sans-serif">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs>
  <rect width="960" height="420" rx="18" fill="#f6f4ef"/>
  <rect x="48" y="60" width="240" height="120" rx="14" fill="#fff" stroke="#d6d3cd"/>
  <text x="168" y="112" text-anchor="middle" font-size="22" fill="#1c1917">Your app</text>
  <text x="168" y="144" text-anchor="middle" font-size="14" fill="#78716c">POST /v1/shipments</text>
  <rect x="360" y="60" width="240" height="120" rx="14" fill="#fff" stroke="#d6d3cd"/>
  <text x="480" y="112" text-anchor="middle" font-size="22" fill="#1c1917">Tidewater API</text>
  <text x="480" y="144" text-anchor="middle" font-size="14" fill="#78716c">Bearer tw_live_…</text>
  <rect x="672" y="60" width="240" height="120" rx="14" fill="#fff" stroke="#d6d3cd"/>
  <text x="792" y="112" text-anchor="middle" font-size="22" fill="#1c1917">Carrier network</text>
  <text x="792" y="144" text-anchor="middle" font-size="14" fill="#78716c">12 carriers, 40 ports</text>
  <path d="M288 120 H360 M600 120 H672" stroke="url(#g)" stroke-width="4" fill="none"/>
  <rect x="360" y="250" width="240" height="100" rx="14" fill="#fff" stroke="#d6d3cd"/>
  <text x="480" y="295" text-anchor="middle" font-size="20" fill="#1c1917">Webhooks</text>
  <text x="480" y="322" text-anchor="middle" font-size="14" fill="#78716c">shipment.updated</text>
  <path d="M480 180 V250" stroke="url(#g)" stroke-width="4" fill="none" stroke-dasharray="8 6"/>
</svg>`;

// ─── Content ─────────────────────────────────────────────────────────────────
// Each page has the same slug in both languages (alternates map 1:1). The
// Markdown deliberately covers everything the reader renders: h2/h3, inline
// code, links, ordered + bulleted lists, tables, bash + ts fences, callouts,
// Tabs, CardGroup/Card, Steps, Accordion, an image, a blockquote.

const GROUPS = [
  { slug: 'getting-started', icon: 'rocket', title: { en: 'Getting started', ar: 'البدء' } },
  { slug: 'guides', icon: 'book-open', title: { en: 'Guides', ar: 'الأدلة' } },
  { slug: 'reference', icon: 'braces', title: { en: 'Reference', ar: 'المرجع' } },
];

const CURL_SHIPMENT = `\`\`\`bash
curl https://api.tidewater.dev/v1/shipments \\
  -H "Authorization: Bearer tw_live_9f3c…" \\
  -H "Content-Type: application/json" \\
  -d '{"origin":"AEJEA","destination":"NLRTM","containers":2}'
\`\`\``;

const TS_CLIENT = `\`\`\`ts title="shipments.ts"
import { Tidewater } from '@tidewater/sdk';

const client = new Tidewater({ apiKey: process.env.TIDEWATER_KEY! });

const shipment = await client.shipments.create({
  origin: 'AEJEA',
  destination: 'NLRTM',
  containers: 2,
});

console.log(shipment.id, shipment.eta);
\`\`\``;

const PAGES = [
  {
    group: 'getting-started',
    slug: 'introduction',
    icon: 'compass',
    en: {
      title: 'Introduction',
      description: 'Tidewater is a shipping API for booking, tracking, and settling container freight from one integration.',
      content: `Tidewater gives your product a single, well-documented surface for the messy world of ocean freight. You create a **shipment**, we negotiate with carriers, and you receive \`shipment.updated\` webhooks as the containers move.

## What you can build

<CardGroup cols="2">
  <Card title="Book freight" icon="ship" href="/guides/webhooks">
    Create shipments between any of 40 supported ports with one request.
  </Card>
  <Card title="Track containers" icon="radar" href="/guides/webhooks">
    Subscribe to live position and customs events instead of polling.
  </Card>
  <Card title="Authenticate" icon="key" href="/guides/authentication">
    Scoped API keys, rotating secrets, and per-environment credentials.
  </Card>
  <Card title="Handle errors" icon="shield-alert" href="/guides/errors">
    Every failure has a stable code, a human message, and a retry hint.
  </Card>
</CardGroup>

## How it fits together

<Frame caption="A shipment request flows through the API to the carrier network; state changes come back as webhooks.">
![Tidewater architecture](/api/public/assets/preview/architecture.svg)
</Frame>

The API is organised around three resources:

- **Shipments** — a booking between an origin and a destination port.
- **Containers** — the physical boxes attached to a shipment, each with its own tracking history.
- **Documents** — bills of lading, customs declarations, and invoices generated on your behalf.

<Callout type="info">
All endpoints are versioned under \`/v1\`. Breaking changes ship under a new prefix and the previous version stays available for at least twelve months.
</Callout>

## Next steps

1. [Install the SDK](/getting-started/installation) for your language.
2. Follow the [quickstart](/getting-started/quickstart) to book a test shipment.
3. Read about [authentication](/guides/authentication) before going live.`,
    },
    ar: {
      title: 'مقدمة',
      description: 'تايدووتر واجهة برمجية للشحن البحري تتيح حجز الحاويات وتتبعها وتسوية تكاليفها من تكامل واحد.',
      content: `تمنح تايدووتر منتجك واجهة واحدة موثقة جيدًا لعالم الشحن البحري المعقد. أنت تنشئ **شحنة**، ونحن نتفاوض مع شركات النقل، وتتلقى إشعارات \`shipment.updated\` كلما تحركت الحاويات.

## ما الذي يمكنك بناؤه

<CardGroup cols="2">
  <Card title="حجز الشحنات" icon="ship" href="/guides/webhooks">
    أنشئ شحنات بين أي ميناءين من 40 ميناءً مدعومًا بطلب واحد.
  </Card>
  <Card title="تتبع الحاويات" icon="radar" href="/guides/webhooks">
    اشترك في أحداث الموقع والجمارك المباشرة بدلًا من الاستعلام المتكرر.
  </Card>
  <Card title="المصادقة" icon="key" href="/guides/authentication">
    مفاتيح واجهة برمجية محددة النطاق، وأسرار دوّارة، وبيانات اعتماد لكل بيئة.
  </Card>
  <Card title="معالجة الأخطاء" icon="shield-alert" href="/guides/errors">
    لكل فشل رمز ثابت ورسالة مفهومة وتلميح لإعادة المحاولة.
  </Card>
</CardGroup>

## كيف تترابط الأجزاء

<Frame caption="يمر طلب الشحنة عبر الواجهة البرمجية إلى شبكة شركات النقل، وتعود تغييرات الحالة على شكل إشعارات ويب.">
![بنية تايدووتر](/api/public/assets/preview/architecture.svg)
</Frame>

تنتظم الواجهة البرمجية حول ثلاثة موارد:

- **الشحنات** — حجز بين ميناء المنشأ وميناء الوجهة.
- **الحاويات** — الصناديق الفعلية المرتبطة بالشحنة، ولكل منها سجل تتبع خاص.
- **المستندات** — بوالص الشحن والتصريحات الجمركية والفواتير التي تُنشأ نيابة عنك.

<Callout type="info">
جميع نقاط النهاية مُصدَّرة تحت \`/v1\`. تُطرح التغييرات الجذرية تحت بادئة جديدة، ويبقى الإصدار السابق متاحًا لمدة اثني عشر شهرًا على الأقل.
</Callout>

## الخطوات التالية

1. [ثبّت حزمة التطوير](/getting-started/installation) للغة التي تستخدمها.
2. اتبع [دليل البدء السريع](/getting-started/quickstart) لحجز شحنة تجريبية.
3. اقرأ عن [المصادقة](/guides/authentication) قبل الانتقال إلى الإنتاج.`,
    },
  },
  {
    group: 'getting-started',
    slug: 'installation',
    icon: 'download',
    en: {
      title: 'Installation',
      description: 'Install the official SDK or call the REST API directly.',
      content: `The SDK wraps the REST API with typed methods, automatic retries, and webhook signature verification.

## Install the SDK

<Tabs>
  <Tab title="npm">
\`\`\`bash
npm install @tidewater/sdk
\`\`\`
  </Tab>
  <Tab title="pnpm">
\`\`\`bash
pnpm add @tidewater/sdk
\`\`\`
  </Tab>
  <Tab title="Python">
\`\`\`bash
pip install tidewater
\`\`\`
  </Tab>
</Tabs>

## Configure credentials

<Steps>
  <Step title="Create an API key">
    Open **Settings → API keys** in the dashboard and create a key scoped to the \`sandbox\` environment.
  </Step>
  <Step title="Store it as an environment variable">
\`\`\`bash
export TIDEWATER_KEY="tw_test_4b1e…"
\`\`\`
  </Step>
  <Step title="Verify the connection">
    Call \`client.ping()\` — a healthy response returns the environment name and the rate-limit headroom.
  </Step>
</Steps>

<Callout type="warning">
Never commit live keys. Sandbox keys start with \`tw_test_\`, live keys with \`tw_live_\`; the API rejects a live key sent to the sandbox host.
</Callout>

## Supported runtimes

| Runtime | Minimum version | Notes |
| --- | --- | --- |
| Node.js | 20 | Native \`fetch\`, ESM and CJS builds |
| Bun | 1.1 | Uses the Node build |
| Python | 3.10 | Async client via \`tidewater.aio\` |
| Deno | 1.44 | Import from npm: specifier |`,
    },
    ar: {
      title: 'التثبيت',
      description: 'ثبّت حزمة التطوير الرسمية أو استدعِ واجهة REST مباشرة.',
      content: `تغلّف حزمة التطوير واجهة REST بدوال ذات أنواع محددة، وإعادة محاولة تلقائية، والتحقق من توقيع إشعارات الويب.

## تثبيت حزمة التطوير

<Tabs>
  <Tab title="npm">
\`\`\`bash
npm install @tidewater/sdk
\`\`\`
  </Tab>
  <Tab title="pnpm">
\`\`\`bash
pnpm add @tidewater/sdk
\`\`\`
  </Tab>
  <Tab title="Python">
\`\`\`bash
pip install tidewater
\`\`\`
  </Tab>
</Tabs>

## إعداد بيانات الاعتماد

<Steps>
  <Step title="أنشئ مفتاح واجهة برمجية">
    افتح **الإعدادات ← مفاتيح الواجهة البرمجية** في لوحة التحكم وأنشئ مفتاحًا محدود النطاق لبيئة \`sandbox\`.
  </Step>
  <Step title="خزّنه كمتغير بيئة">
\`\`\`bash
export TIDEWATER_KEY="tw_test_4b1e…"
\`\`\`
  </Step>
  <Step title="تحقق من الاتصال">
    استدعِ \`client.ping()\` — تعيد الاستجابة السليمة اسم البيئة والحد المتبقي من معدل الطلبات.
  </Step>
</Steps>

<Callout type="warning">
لا تودع المفاتيح الحية في المستودع أبدًا. تبدأ مفاتيح البيئة التجريبية بـ \`tw_test_\` والمفاتيح الحية بـ \`tw_live_\`، وترفض الواجهة البرمجية أي مفتاح حي يُرسل إلى مضيف البيئة التجريبية.
</Callout>

## بيئات التشغيل المدعومة

| بيئة التشغيل | أدنى إصدار | ملاحظات |
| --- | --- | --- |
| Node.js | 20 | \`fetch\` مدمج، وإصدارات ESM وCJS |
| Bun | 1.1 | يستخدم إصدار Node |
| Python | 3.10 | عميل غير متزامن عبر \`tidewater.aio\` |
| Deno | 1.44 | الاستيراد عبر محدد npm: |`,
    },
  },
  {
    group: 'getting-started',
    slug: 'quickstart',
    icon: 'zap',
    tag: 'New',
    en: {
      title: 'Quickstart',
      description: 'Book your first sandbox shipment in under five minutes.',
      content: `This walkthrough creates a shipment from Jebel Ali to Rotterdam in the sandbox and watches it move.

## Create a shipment

${TS_CLIENT}

The same call over plain HTTP:

${CURL_SHIPMENT}

## Read the response

\`\`\`json
{
  "id": "shp_01J9X3K2",
  "status": "booked",
  "eta": "2026-09-28T06:00:00Z",
  "containers": ["cnt_7f1a", "cnt_7f1b"]
}
\`\`\`

## Watch it move

In the sandbox, shipments advance through their lifecycle every thirty seconds so you can test your webhook handlers without waiting for a real vessel.

1. Register a webhook endpoint (see [Webhooks](/guides/webhooks)).
2. Create the shipment above.
3. Expect \`shipment.updated\` events for \`booked → loaded → at_sea → arrived\`.

<Tip>
Pass \`"speed": "fast"\` in the sandbox request body to compress the whole lifecycle into about two minutes.
</Tip>

> Sandbox data is wiped every Sunday at 02:00 UTC. Anything you need to keep should be recreated by your test setup.`,
    },
    ar: {
      title: 'البدء السريع',
      description: 'احجز أول شحنة تجريبية في أقل من خمس دقائق.',
      content: `ينشئ هذا الدليل شحنة من جبل علي إلى روتردام في البيئة التجريبية ويتابع حركتها.

## إنشاء شحنة

${TS_CLIENT}

الاستدعاء نفسه عبر HTTP مباشرة:

${CURL_SHIPMENT}

## قراءة الاستجابة

\`\`\`json
{
  "id": "shp_01J9X3K2",
  "status": "booked",
  "eta": "2026-09-28T06:00:00Z",
  "containers": ["cnt_7f1a", "cnt_7f1b"]
}
\`\`\`

## متابعة الحركة

في البيئة التجريبية تتقدم الشحنات في دورة حياتها كل ثلاثين ثانية، لتتمكن من اختبار معالجات إشعارات الويب دون انتظار سفينة حقيقية.

1. سجّل نقطة نهاية لإشعارات الويب (انظر [إشعارات الويب](/guides/webhooks)).
2. أنشئ الشحنة الموضحة أعلاه.
3. توقّع أحداث \`shipment.updated\` للحالات \`booked → loaded → at_sea → arrived\`.

<Tip>
مرّر \`"speed": "fast"\` في جسم الطلب التجريبي لضغط دورة الحياة كاملة في نحو دقيقتين.
</Tip>

> تُمسح بيانات البيئة التجريبية كل يوم أحد في الساعة 02:00 بالتوقيت العالمي. أي شيء تحتاج إلى الاحتفاظ به ينبغي أن يعيد إعداد الاختبار إنشاءه.`,
    },
  },
  {
    group: 'guides',
    slug: 'authentication',
    icon: 'key',
    en: {
      title: 'Authentication',
      description: 'Authenticate requests with scoped API keys, and rotate them without downtime.',
      content: `Every request to Tidewater carries a bearer token. Keys are scoped to an **environment** (\`sandbox\` or \`live\`) and to a set of **permissions**, so a key that only tracks containers can never create a booking.

## Send the token

Pass the key in the \`Authorization\` header. Requests without it — or with a key from the wrong environment — return \`401 unauthorized\`.

${CURL_SHIPMENT}

### From the SDK

The SDK reads \`TIDEWATER_KEY\` automatically, or you can pass it explicitly:

\`\`\`ts
import { Tidewater } from '@tidewater/sdk';

export const tidewater = new Tidewater({
  apiKey: process.env.TIDEWATER_KEY!,
  environment: 'live',
  maxRetries: 3,
});
\`\`\`

<Callout type="info">
Keys are hashed at rest and shown only once when created. If you lose one, revoke it and create a replacement.
</Callout>

## Choose a key type

<Tabs>
  <Tab title="Server keys">
    Full-permission keys for trusted backends. Never ship them in a browser or a mobile app.

    - Prefix: \`tw_live_\` or \`tw_test_\`
    - Rate limit: 600 requests per minute
  </Tab>
  <Tab title="Restricted keys">
    Keys with an explicit permission list — ideal for partners, CI, or internal tools.

    - Prefix: \`tw_rk_\`
    - Rate limit: 120 requests per minute
  </Tab>
  <Tab title="Publishable keys">
    Read-only keys safe to embed in client code for tracking widgets.

    - Prefix: \`tw_pk_\`
    - Rate limit: 60 requests per minute per IP
  </Tab>
</Tabs>

## Permissions

| Permission | Grants | Typical use |
| --- | --- | --- |
| \`shipments:read\` | List and retrieve shipments | Dashboards, tracking pages |
| \`shipments:write\` | Create, amend, and cancel shipments | Booking flows |
| \`documents:read\` | Download generated documents | Customs brokers |
| \`webhooks:manage\` | Register and rotate endpoints | Infrastructure automation |

<Warning>
A key with \`shipments:write\` can incur real charges in the live environment. Restrict it to the services that need it.
</Warning>

## Rotate a key without downtime

<Steps>
  <Step title="Create the replacement">
    Create a new key with the same permissions. Both keys are valid at the same time.
  </Step>
  <Step title="Deploy the new key">
    Update your secret store and roll your services. Watch the **Last used** column in the dashboard.
  </Step>
  <Step title="Revoke the old key">
    Once the old key shows no traffic for a full day, revoke it. Revocation is immediate and cannot be undone.
  </Step>
</Steps>

## Common questions

<AccordionGroup>
  <Accordion title="Can one key work in both environments?">
    No. Environments are fully isolated; a sandbox key sent to the live host is rejected before any handler runs.
  </Accordion>
  <Accordion title="How do I authenticate webhooks?">
    Webhooks are signed with a separate secret. See [Webhooks](/guides/webhooks) for the verification snippet.
  </Accordion>
  <Accordion title="Do you support OAuth?" defaultOpen>
    OAuth 2.0 client credentials are available on the Enterprise plan for partners who act on behalf of many accounts.
  </Accordion>
</AccordionGroup>

<CardGroup cols="2">
  <Card title="Webhooks" icon="webhook" href="/guides/webhooks">
    Verify signatures and handle retries.
  </Card>
  <Card title="Error codes" icon="shield-alert" href="/guides/errors">
    Every \`401\` and \`403\` explained.
  </Card>
</CardGroup>

> Treat API keys like passwords: store them in a secrets manager, never in source control, and rotate them on a schedule.`,
    },
    ar: {
      title: 'المصادقة',
      description: 'صادق على الطلبات بمفاتيح واجهة برمجية محددة النطاق، وبدّلها دون انقطاع في الخدمة.',
      content: `يحمل كل طلب إلى تايدووتر رمز حامل. المفاتيح محددة النطاق حسب **البيئة** (\`sandbox\` أو \`live\`) وحسب مجموعة من **الصلاحيات**، فالمفتاح الذي يتتبع الحاويات فقط لا يمكنه إنشاء حجز أبدًا.

## إرسال الرمز

مرّر المفتاح في ترويسة \`Authorization\`. تعيد الطلبات التي لا تحمله — أو تحمل مفتاحًا من بيئة خاطئة — الاستجابة \`401 unauthorized\`.

${CURL_SHIPMENT}

### من حزمة التطوير

تقرأ حزمة التطوير \`TIDEWATER_KEY\` تلقائيًا، أو يمكنك تمريره صراحةً:

\`\`\`ts
import { Tidewater } from '@tidewater/sdk';

export const tidewater = new Tidewater({
  apiKey: process.env.TIDEWATER_KEY!,
  environment: 'live',
  maxRetries: 3,
});
\`\`\`

<Callout type="info">
تُخزَّن المفاتيح مجزأة ولا تُعرض إلا مرة واحدة عند إنشائها. إذا فقدت أحدها فألغِه وأنشئ بديلًا.
</Callout>

## اختيار نوع المفتاح

<Tabs>
  <Tab title="مفاتيح الخادم">
    مفاتيح كاملة الصلاحيات للخوادم الموثوقة. لا تضمّنها أبدًا في متصفح أو تطبيق جوال.

    - البادئة: \`tw_live_\` أو \`tw_test_\`
    - حد المعدل: 600 طلب في الدقيقة
  </Tab>
  <Tab title="المفاتيح المقيدة">
    مفاتيح بقائمة صلاحيات صريحة — مثالية للشركاء وأنظمة التكامل المستمر والأدوات الداخلية.

    - البادئة: \`tw_rk_\`
    - حد المعدل: 120 طلبًا في الدقيقة
  </Tab>
  <Tab title="المفاتيح القابلة للنشر">
    مفاتيح للقراءة فقط يمكن تضمينها بأمان في كود العميل لأدوات التتبع.

    - البادئة: \`tw_pk_\`
    - حد المعدل: 60 طلبًا في الدقيقة لكل عنوان IP
  </Tab>
</Tabs>

## الصلاحيات

| الصلاحية | تمنح | الاستخدام المعتاد |
| --- | --- | --- |
| \`shipments:read\` | عرض الشحنات واسترجاعها | لوحات التحكم وصفحات التتبع |
| \`shipments:write\` | إنشاء الشحنات وتعديلها وإلغاؤها | مسارات الحجز |
| \`documents:read\` | تنزيل المستندات المُنشأة | الوسطاء الجمركيون |
| \`webhooks:manage\` | تسجيل نقاط النهاية وتبديلها | أتمتة البنية التحتية |

<Warning>
قد يتسبب مفتاح يحمل \`shipments:write\` في رسوم حقيقية في البيئة الحية. اقصره على الخدمات التي تحتاجه.
</Warning>

## تبديل مفتاح دون انقطاع

<Steps>
  <Step title="أنشئ البديل">
    أنشئ مفتاحًا جديدًا بالصلاحيات نفسها. يكون المفتاحان صالحين في الوقت ذاته.
  </Step>
  <Step title="انشر المفتاح الجديد">
    حدّث مخزن الأسرار وأعد تشغيل خدماتك. راقب عمود **آخر استخدام** في لوحة التحكم.
  </Step>
  <Step title="ألغِ المفتاح القديم">
    عندما يظهر المفتاح القديم دون أي حركة ليوم كامل، ألغِه. الإلغاء فوري ولا يمكن التراجع عنه.
  </Step>
</Steps>

## أسئلة شائعة

<AccordionGroup>
  <Accordion title="هل يعمل مفتاح واحد في البيئتين؟">
    لا. البيئتان معزولتان تمامًا؛ يُرفض مفتاح البيئة التجريبية المرسل إلى المضيف الحي قبل تشغيل أي معالج.
  </Accordion>
  <Accordion title="كيف أصادق على إشعارات الويب؟">
    تُوقَّع إشعارات الويب بسر منفصل. انظر [إشعارات الويب](/guides/webhooks) للاطلاع على مقطع التحقق.
  </Accordion>
  <Accordion title="هل تدعمون OAuth؟" defaultOpen>
    بيانات اعتماد عميل OAuth 2.0 متاحة في خطة المؤسسات للشركاء الذين يتصرفون نيابة عن حسابات عديدة.
  </Accordion>
</AccordionGroup>

<CardGroup cols="2">
  <Card title="إشعارات الويب" icon="webhook" href="/guides/webhooks">
    تحقق من التوقيعات وعالج إعادة المحاولات.
  </Card>
  <Card title="رموز الأخطاء" icon="shield-alert" href="/guides/errors">
    شرح كل استجابة \`401\` و\`403\`.
  </Card>
</CardGroup>

> تعامل مع مفاتيح الواجهة البرمجية كما تتعامل مع كلمات المرور: خزّنها في مدير أسرار، ولا تضعها أبدًا في نظام التحكم بالمصدر، وبدّلها وفق جدول زمني.`,
    },
  },
  {
    group: 'guides',
    slug: 'webhooks',
    icon: 'webhook',
    en: {
      title: 'Webhooks',
      description: 'Receive shipment events on your own endpoint and verify their signatures.',
      content: `Webhooks push state changes to an HTTPS endpoint you control, so you never poll.

## Register an endpoint

\`\`\`bash
curl -X POST https://api.tidewater.dev/v1/webhooks \\
  -H "Authorization: Bearer tw_live_9f3c…" \\
  -d '{"url":"https://example.com/hooks/tidewater","events":["shipment.updated"]}'
\`\`\`

## Verify the signature

\`\`\`ts
import { verifyWebhook } from '@tidewater/sdk';

export async function handler(request: Request) {
  const event = await verifyWebhook(request, process.env.TIDEWATER_WEBHOOK_SECRET!);
  if (event.type === 'shipment.updated') {
    await db.shipments.update(event.data.id, { status: event.data.status });
  }
  return new Response(null, { status: 204 });
}
\`\`\`

## Event catalogue

| Event | When | Payload |
| --- | --- | --- |
| \`shipment.updated\` | Any lifecycle change | The full shipment |
| \`container.position\` | Every AIS position fix | Container id, coordinates, timestamp |
| \`document.ready\` | A generated document is available | Document id and download URL |

<Callout type="tip">
Respond with a \`2xx\` within five seconds. Slower endpoints are retried with exponential backoff for up to 24 hours.
</Callout>`,
    },
    ar: {
      title: 'إشعارات الويب',
      description: 'استقبل أحداث الشحنات على نقطة نهاية خاصة بك وتحقق من توقيعاتها.',
      content: `تدفع إشعارات الويب تغييرات الحالة إلى نقطة نهاية HTTPS تتحكم بها، فلا تحتاج إلى الاستعلام المتكرر أبدًا.

## تسجيل نقطة نهاية

\`\`\`bash
curl -X POST https://api.tidewater.dev/v1/webhooks \\
  -H "Authorization: Bearer tw_live_9f3c…" \\
  -d '{"url":"https://example.com/hooks/tidewater","events":["shipment.updated"]}'
\`\`\`

## التحقق من التوقيع

\`\`\`ts
import { verifyWebhook } from '@tidewater/sdk';

export async function handler(request: Request) {
  const event = await verifyWebhook(request, process.env.TIDEWATER_WEBHOOK_SECRET!);
  if (event.type === 'shipment.updated') {
    await db.shipments.update(event.data.id, { status: event.data.status });
  }
  return new Response(null, { status: 204 });
}
\`\`\`

## فهرس الأحداث

| الحدث | متى | الحمولة |
| --- | --- | --- |
| \`shipment.updated\` | أي تغيير في دورة الحياة | الشحنة كاملة |
| \`container.position\` | كل تحديث موقع من نظام AIS | معرّف الحاوية والإحداثيات والطابع الزمني |
| \`document.ready\` | توفر مستند مُنشأ | معرّف المستند ورابط التنزيل |

<Callout type="tip">
استجب برمز \`2xx\` خلال خمس ثوانٍ. تُعاد المحاولة مع نقاط النهاية الأبطأ بتراجع أسّي لمدة تصل إلى 24 ساعة.
</Callout>`,
    },
  },
  {
    group: 'guides',
    slug: 'errors',
    icon: 'shield-alert',
    en: {
      title: 'Error handling',
      description: 'Every error carries a stable code, a readable message, and whether a retry is safe.',
      content: `Errors use conventional HTTP status codes and a JSON body you can branch on.

\`\`\`json
{
  "error": {
    "code": "port_not_supported",
    "message": "Port 'XXABC' is not in the Tidewater network.",
    "retryable": false
  }
}
\`\`\`

## Status codes

| Status | Meaning | Retry? |
| --- | --- | --- |
| \`400\` | Malformed request body | No |
| \`401\` | Missing or invalid API key | No |
| \`403\` | Key lacks the required permission | No |
| \`404\` | Resource does not exist in this environment | No |
| \`409\` | The shipment changed while you were amending it | Yes, after refetch |
| \`429\` | Rate limit exceeded | Yes, after \`Retry-After\` |
| \`5xx\` | Tidewater problem | Yes, with backoff |

<Danger>
Do not retry \`400\`–\`404\` responses automatically: the request will fail identically and count against your rate limit.
</Danger>

## Idempotency

Send an \`Idempotency-Key\` header on every \`POST\`. Replays within 24 hours return the original response instead of creating a duplicate booking.`,
    },
    ar: {
      title: 'معالجة الأخطاء',
      description: 'يحمل كل خطأ رمزًا ثابتًا ورسالة مقروءة وبيانًا بما إذا كانت إعادة المحاولة آمنة.',
      content: `تستخدم الأخطاء رموز حالة HTTP المتعارف عليها وجسم JSON يمكنك التفرع بناءً عليه.

\`\`\`json
{
  "error": {
    "code": "port_not_supported",
    "message": "Port 'XXABC' is not in the Tidewater network.",
    "retryable": false
  }
}
\`\`\`

## رموز الحالة

| الحالة | المعنى | إعادة المحاولة؟ |
| --- | --- | --- |
| \`400\` | جسم طلب غير صالح | لا |
| \`401\` | مفتاح مفقود أو غير صالح | لا |
| \`403\` | المفتاح يفتقر إلى الصلاحية المطلوبة | لا |
| \`404\` | المورد غير موجود في هذه البيئة | لا |
| \`409\` | تغيرت الشحنة أثناء تعديلك لها | نعم، بعد إعادة الجلب |
| \`429\` | تجاوز حد المعدل | نعم، بعد \`Retry-After\` |
| \`5xx\` | مشكلة في تايدووتر | نعم، مع تراجع أسّي |

<Danger>
لا تعد محاولة الاستجابات \`400\`–\`404\` تلقائيًا: سيفشل الطلب بالطريقة نفسها ويُحتسب ضمن حد المعدل.
</Danger>

## التكرار الآمن

أرسل ترويسة \`Idempotency-Key\` مع كل طلب \`POST\`. تعيد الطلبات المكررة خلال 24 ساعة الاستجابة الأصلية بدلًا من إنشاء حجز مكرر.`,
    },
  },
  {
    group: 'reference',
    slug: 'shipments',
    icon: 'ship',
    en: {
      title: 'Shipments',
      description: 'Create, retrieve, amend, and cancel shipments.',
      content: `## Create a shipment

\`POST /v1/shipments\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`origin\` | string | yes | UN/LOCODE of the loading port |
| \`destination\` | string | yes | UN/LOCODE of the discharge port |
| \`containers\` | integer | yes | Number of 40ft containers (1–200) |
| \`incoterm\` | string | no | Defaults to \`FOB\` |
| \`speed\` | string | sandbox only | \`normal\` or \`fast\` |

${CURL_SHIPMENT}

## Retrieve a shipment

\`GET /v1/shipments/{id}\`

Returns the shipment with its containers, current position, and document links.

## Cancel a shipment

\`POST /v1/shipments/{id}/cancel\`

Cancellation is free until the containers are gated in at the origin port; after that a carrier fee applies and is itemised in the response.`,
    },
    ar: {
      title: 'الشحنات',
      description: 'إنشاء الشحنات واسترجاعها وتعديلها وإلغاؤها.',
      content: `## إنشاء شحنة

\`POST /v1/shipments\`

| الحقل | النوع | مطلوب | الوصف |
| --- | --- | --- | --- |
| \`origin\` | نص | نعم | رمز UN/LOCODE لميناء التحميل |
| \`destination\` | نص | نعم | رمز UN/LOCODE لميناء التفريغ |
| \`containers\` | عدد صحيح | نعم | عدد حاويات 40 قدمًا (1–200) |
| \`incoterm\` | نص | لا | الافتراضي \`FOB\` |
| \`speed\` | نص | البيئة التجريبية فقط | \`normal\` أو \`fast\` |

${CURL_SHIPMENT}

## استرجاع شحنة

\`GET /v1/shipments/{id}\`

يعيد الشحنة مع حاوياتها وموقعها الحالي وروابط مستنداتها.

## إلغاء شحنة

\`POST /v1/shipments/{id}/cancel\`

الإلغاء مجاني حتى دخول الحاويات بوابة ميناء المنشأ؛ بعد ذلك تُطبَّق رسوم شركة النقل وتُفصَّل في الاستجابة.`,
    },
  },
  {
    group: 'reference',
    slug: 'rate-limits',
    icon: 'gauge',
    en: {
      title: 'Rate limits',
      description: 'Per-key request budgets and the headers that report them.',
      content: `Limits are enforced per API key over a sliding sixty-second window.

| Key type | Requests per minute | Burst |
| --- | --- | --- |
| Server | 600 | 100 |
| Restricted | 120 | 30 |
| Publishable | 60 per IP | 10 |

Every response includes:

- \`RateLimit-Limit\` — the budget for the current window
- \`RateLimit-Remaining\` — requests left in the window
- \`RateLimit-Reset\` — seconds until the window resets

<Note>
Need more headroom? Enterprise plans include dedicated capacity and per-endpoint limits.
</Note>`,
    },
    ar: {
      title: 'حدود المعدل',
      description: 'ميزانيات الطلبات لكل مفتاح والترويسات التي تُبلغ عنها.',
      content: `تُطبَّق الحدود لكل مفتاح واجهة برمجية على نافذة منزلقة مدتها ستون ثانية.

| نوع المفتاح | الطلبات في الدقيقة | الدفعة القصوى |
| --- | --- | --- |
| الخادم | 600 | 100 |
| المقيد | 120 | 30 |
| القابل للنشر | 60 لكل عنوان IP | 10 |

تتضمن كل استجابة:

- \`RateLimit-Limit\` — ميزانية النافذة الحالية
- \`RateLimit-Remaining\` — الطلبات المتبقية في النافذة
- \`RateLimit-Reset\` — الثواني المتبقية حتى إعادة ضبط النافذة

<Note>
هل تحتاج إلى سعة أكبر؟ تشمل خطط المؤسسات سعة مخصصة وحدودًا لكل نقطة نهاية.
</Note>`,
    },
  },
];

// ─── Projects ────────────────────────────────────────────────────────────────

const SITE_NAME = { en: 'Tidewater Docs', ar: 'مستندات تايدووتر' };
const SITE_DESCRIPTION = {
  en: 'Developer documentation for the Tidewater shipping API.',
  ar: 'وثائق المطورين لواجهة تايدووتر البرمجية للشحن.',
};

const baseConfig = () => ({
  visibility: 'public',
  styling: { theme: 'light' },
  navbar: {
    ctaLabel: 'Get an API key',
    ctaUrl: 'https://example.com/tidewater/signup',
    links: [
      { label: 'Guides', href: '/guides' },
      { label: 'Reference', href: '/reference' },
      { label: 'Status', href: 'https://status.example.com', external: true },
    ],
    showSearch: true,
    changelog: true,
  },
  footer: {
    copyright: '© 2026 Tidewater Labs. All rights reserved.',
    github: 'https://github.com/example/tidewater',
    x: 'https://x.com/example',
    madeWithBadge: true,
  },
  search: { placeholder: 'Search the docs…', hotkey: 'cmdk' },
  addons: { feedback: true, feedbackPlacement: 'after-content', feedbackPresentation: 'compact' },
});

const THEME_META = {
  harbor: { name: 'Harbor', description: 'Reference layout with a calm, structured sidebar.' },
  manuscript: { name: 'Manuscript', description: 'Editorial layout that reads like a printed manual.' },
  signal: { name: 'Signal', description: 'Console layout with a dark rail and dense navigation.' },
};

const PROJECTS = {
  'preview-harbor': { preset: 'harbor' },
  'preview-manuscript': { preset: 'manuscript' },
  'preview-signal': { preset: 'signal' },
  'preview-legacy': { preset: null },
};

const projectConfig = (preset) => {
  const config = baseConfig();
  if (preset) {
    config.theme = { version: 1, preset, metadata: THEME_META[preset] };
  } else {
    config.styling.primaryColor = '#5546e8';
  }
  return config;
};

// Per-language chrome overrides (mirrors LanguageConfig; merged into
// project.config for non-default languages like the real server does).
const LANGUAGE_CONFIG = {
  en: { name: SITE_NAME.en, description: SITE_DESCRIPTION.en },
  ar: {
    name: SITE_NAME.ar,
    description: SITE_DESCRIPTION.ar,
    navbar: {
      ctaLabel: 'احصل على مفتاح API',
      links: [
        { label: 'الأدلة', href: '/guides' },
        { label: 'المرجع', href: '/reference' },
        { label: 'الحالة', href: 'https://status.example.com', external: true },
      ],
    },
    footer: { copyright: '© 2026 مختبرات تايدووتر. جميع الحقوق محفوظة.' },
    search: { placeholder: 'ابحث في المستندات…' },
  },
};

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeLanguageChrome = (config, languageConfig) => {
  if (!languageConfig) return config;
  let merged = null;
  for (const section of ['navbar', 'footer', 'banner', 'search']) {
    const override = languageConfig[section];
    if (!isPlainObject(override)) continue;
    const entries = Object.entries(override).filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
    );
    if (entries.length === 0) continue;
    merged = merged ?? { ...(config ?? {}) };
    const base = merged[section];
    merged[section] = { ...(isPlainObject(base) ? base : {}), ...Object.fromEntries(entries) };
  }
  return merged ?? config;
};

// ─── Derivations (nav, headings, neighbours) ─────────────────────────────────

// github-slugger-compatible enough for the sample content: lowercase, drop
// punctuation, keep Unicode letters/marks/numbers, spaces -> hyphens, dedupe.
const makeSlugger = () => {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N} -]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
};

const stripInlineMarkdown = (text) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$2')
    .trim();

const extractHeadings = (markdown) => {
  const headings = [];
  const slug = makeSlugger();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2]);
    headings.push({ depth: match[1].length, text, id: slug(text) });
  }
  return headings;
};

// The authored samples above indent component children for readability, but
// CommonMark treats 4-space-indented lines as code blocks. Strip that
// indentation outside fenced code so the reader renders the real components.
const dedentOutsideFences = (markdown) => {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return line.trimStart();
      }
      return inFence ? line : line.replace(/^ +/, '');
    })
    .join('\n');
};

const pagePath = (page) => `${page.group}/${page.slug}`;
const pageId = (page, lang) => `pg_${lang}_${page.group}_${page.slug}`;

const buildNav = (lang) =>
  GROUPS.map((group) => ({
    id: `grp_${lang}_${group.slug}`,
    kind: 'GROUP',
    title: group.title[lang],
    path: group.slug,
    icon: group.icon,
    tag: null,
    children: PAGES.filter((page) => page.group === group.slug).map((page) => ({
      id: pageId(page, lang),
      kind: 'PAGE',
      title: page[lang].title,
      path: pagePath(page),
      icon: page.icon ?? null,
      tag: page.tag ?? null,
      children: [],
    })),
  }));

const resolveLanguage = (lang) => LANGUAGES.find((language) => language.code === lang) ?? LANGUAGES.find((language) => language.isDefault);
const resolveVersion = (version) => VERSIONS.find((item) => item.slug === version) ?? VERSIONS.find((item) => item.isDefault);

const cleanPath = (raw) => {
  let path = raw ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep as-is
  }
  path = path.replace(/^\/+|\/+$/g, '');
  const [first, ...rest] = path.split('/');
  if (first && VERSIONS.some((item) => item.slug === first)) {
    path = rest.join('/');
  }
  return path;
};

const findPage = (path) => {
  if (!path) return PAGES[0];
  const direct = PAGES.find((page) => pagePath(page) === path);
  if (direct) return direct;
  const group = GROUPS.find((item) => item.slug === path);
  return group ? PAGES.find((page) => page.group === group.slug) : undefined;
};

const projectPayload = (id, preset, language) => {
  const languageConfig = LANGUAGE_CONFIG[language.code];
  const config = projectConfig(preset);
  return {
    id,
    name: SITE_NAME.en,
    slug: id,
    description: SITE_DESCRIPTION.en,
    config: language.isDefault ? config : mergeLanguageChrome(config, languageConfig),
    primaryDomain: null,
  };
};

const siteShell = (id, preset, query) => {
  const language = resolveLanguage(query.get('lang'));
  const version = resolveVersion(query.get('version'));
  return {
    project: projectPayload(id, preset, language),
    nav: buildNav(language.code),
    languages: LANGUAGES,
    versions: VERSIONS,
    activeLanguage: language.code,
    activeVersion: version.slug,
    languageConfig: LANGUAGE_CONFIG[language.code],
    version: 1,
    generatedAt: GENERATED_AT,
    openapi: null,
  };
};

const sitePage = (id, preset, query) => {
  const language = resolveLanguage(query.get('lang'));
  const version = resolveVersion(query.get('version'));
  const page = findPage(cleanPath(query.get('path')));
  if (!page) return null;
  const lang = language.code;
  const index = PAGES.indexOf(page);
  const prev = PAGES[index - 1];
  const next = PAGES[index + 1];
  const group = GROUPS.find((item) => item.slug === page.group);
  const localized = { ...page[lang], content: dedentOutsideFences(page[lang].content) };
  return {
    project: projectPayload(id, preset, language),
    page: {
      id: pageId(page, lang),
      createdAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-30T14:30:00.000Z',
      title: localized.title,
      description: localized.description,
      icon: page.icon ?? null,
      path: pagePath(page),
      content: localized.content,
      headings: extractHeadings(localized.content),
      config: page.tag ? { tag: page.tag } : null,
    },
    activeLanguage: lang,
    activeVersion: version.slug,
    versions: VERSIONS,
    languageConfig: LANGUAGE_CONFIG[lang],
    languages: LANGUAGES.map((item) => ({ code: item.code, isDefault: item.isDefault, path: pagePath(page) })),
    breadcrumbs: [
      { title: group.title[lang], path: group.slug },
      { title: localized.title, path: pagePath(page) },
    ],
    prev: prev ? { title: prev[lang].title, path: pagePath(prev) } : null,
    next: next ? { title: next[lang].title, path: pagePath(next) } : null,
  };
};

// ─── HTTP ────────────────────────────────────────────────────────────────────

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const SITE_ROUTE = /^\/api\/public\/sites\/([^/]+)(?:\/(.*))?$/;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const { pathname, searchParams } = url;

  if (pathname.startsWith('/api/public/assets/')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
    res.end(DIAGRAM_SVG);
    return;
  }

  const match = SITE_ROUTE.exec(pathname);
  if (match && req.method === 'GET') {
    const [, id, rest = ''] = match;
    const project = PROJECTS[id];
    if (!project) {
      json(res, 404, { error: { code: 'not_found', message: 'Site not found.' } });
      return;
    }
    if (rest === '') {
      json(res, 200, { data: siteShell(id, project.preset, searchParams) });
      return;
    }
    if (rest === 'page') {
      const page = sitePage(id, project.preset, searchParams);
      if (!page) {
        json(res, 404, { error: { code: 'not_found', message: 'Page not found.' } });
        return;
      }
      json(res, 200, { data: page });
      return;
    }
    if (rest === 'search') {
      json(res, 200, { data: { hits: [] } });
      return;
    }
    if (rest === 'changelog') {
      json(res, 200, { data: [] });
      return;
    }
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('site-preview-mock: not an API path');
});

// No host: bind dual-stack so the dev proxy reaches us via ::1 or 127.0.0.1.
server.listen(PORT, () => {
  process.stdout.write(`site-preview-mock listening on http://localhost:${PORT} (projects: ${Object.keys(PROJECTS).join(', ')})\n`);
});
