/**
 * Blind A/B benchmark of the editor's AI writing actions on two models, with
 * the real prompts (`@/lib/ai-draft-prompt`) and request path (`completeWorkspaceText`).
 *
 *   OPENROUTER_API_KEY=… EVAL_DRAFT_OUTPUT_DIR=/private/dir \
 *     pnpm --filter @nibleaf/server eval:drafts
 *
 * Writes `drafts-blind.json` (outputs labelled A/B in a seeded order per item),
 * `drafts-key.json` (which model each label is; keep it from whoever judges) and
 * `drafts-summary.json` (latency and cost per model). Per-output latency and cost
 * are in the blind file too; strip them before judging, since price alone
 * identifies a model.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AiDraftBody } from '@nibleaf/validators';
import { draftMessages } from '@/lib/ai-draft-prompt';

const apiKey = process.env.OPENROUTER_API_KEY;
const outputDir = process.env.EVAL_DRAFT_OUTPUT_DIR;
if (!apiKey || !outputDir) throw new Error('OPENROUTER_API_KEY and EVAL_DRAFT_OUTPUT_DIR are required; credentials are never printed.');
// Drafting never queries the database; the shared module only needs a URL to load.
process.env.POSTGRES_URL ??= 'postgresql://unused@localhost:5432/unused';
const { completeWorkspaceText } = await import('@nibleaf/search/workspace');
const { AI_REASONING_EFFORT } = await import('@nibleaf/search');

const models = (process.env.EVAL_DRAFT_MODELS ?? 'openai/gpt-6-luna,openai/gpt-6.1-terra').split(',').map((id) => id.trim());
if (models.length !== 2) throw new Error('EVAL_DRAFT_MODELS must name exactly two models.');
const effort = (process.env.EVAL_DRAFT_EFFORT ?? AI_REASONING_EFFORT.draft) as typeof AI_REASONING_EFFORT.draft;
const seed = process.env.EVAL_SEED ?? 'nibleaf-drafts-v1';
const budget = Number(process.env.EVAL_MAX_COST_USD ?? 1);

const catalog = (await (await fetch('https://openrouter.ai/api/v1/models')).json()) as {
  data: { id: string; pricing: { prompt: string; completion: string } }[];
};
const price = (id: string) => {
  const found = catalog.data.find((model) => model.id === id)?.pricing;
  if (!found) throw new Error(`Model absent from the live catalog: ${id}`);
  return { input: Number(found.prompt), output: Number(found.completion) };
};
for (const id of models) price(id);

/** One item per writing action and language, on documentation-like text. */
const items: { id: string; language: 'en' | 'ar'; body: AiDraftBody }[] = [
  {
    id: 'en-continue',
    language: 'en',
    body: {
      mode: 'continue',
      content:
        '## Invite your team\n\nOpen **Settings → Members** and choose **Invite member**. Enter one email address per line and pick a role for everyone you invite: Viewers can read drafts, Editors can write and publish, and Admins can also manage billing and members.\n\nInvitations expire after seven days.',
    },
  },
  {
    id: 'en-rephrase',
    language: 'en',
    body: {
      mode: 'rephrase',
      content:
        'In order to be able to make it so that your documentation site is shown on your own domain, what you will need to do is basically go and add a CNAME record at your DNS provider which points to the target that is shown to you in **Site settings → Domains**, and after that you should wait for some time for the DNS to propagate, which can take up to a day in some cases, and then the certificate will be issued for you automatically.',
    },
  },
  {
    id: 'en-outline',
    language: 'en',
    body: {
      mode: 'outline',
      content: 'A guide for support teams moving their help center from Zendesk Guide to Nibleaf, keeping article URLs working.',
    },
  },
  {
    id: 'en-summarize',
    language: 'en',
    body: {
      mode: 'summarize',
      content:
        '## Exports\n\nYou can export a site as Markdown or as a PDF. One-time exports run in the background and appear under **Settings → Exports** when they are ready; the download link stays valid for five minutes after you open it. Scheduled exports run daily or weekly and keep the last seven files. Exports include published pages only, never drafts. Large sites over 5,000 pages must be exported one version at a time.',
      instruction: 'Write it for a non-technical site owner.',
    },
  },
  {
    id: 'ar-continue',
    language: 'ar',
    body: {
      mode: 'continue',
      content:
        '## ادعُ فريقك\n\nافتح **الإعدادات ← الأعضاء** واختر **دعوة عضو**. أدخل عنوان بريد إلكتروني واحدًا في كل سطر، ثم اختر دورًا لكل من تدعوه: يستطيع المشاهد قراءة المسودات، ويكتب المحرر الصفحات وينشرها، ويدير المسؤول أيضًا الفوترة والأعضاء.\n\nتنتهي صلاحية الدعوات بعد سبعة أيام.',
    },
  },
  {
    id: 'ar-rephrase',
    language: 'ar',
    body: {
      mode: 'rephrase',
      content:
        'لكي تتمكن من جعل موقع التوثيق الخاص بك يظهر على النطاق الخاص بك فإن ما عليك فعله في الأساس هو أن تذهب وتضيف سجل CNAME لدى مزود DNS الخاص بك بحيث يشير إلى الهدف الذي يظهر لك في **إعدادات الموقع ← النطاقات**، وبعد ذلك يجب أن تنتظر بعض الوقت حتى ينتشر DNS وهو ما قد يستغرق يومًا كاملًا في بعض الحالات، ثم تصدر الشهادة لك تلقائيًا.',
    },
  },
  {
    id: 'ar-outline',
    language: 'ar',
    body: { mode: 'outline', content: 'دليل لفرق الدعم الفني لنقل مركز المساعدة من Zendesk Guide إلى نيبليف مع الحفاظ على روابط المقالات.' },
  },
  {
    id: 'ar-summarize',
    language: 'ar',
    body: {
      mode: 'summarize',
      content:
        '## التصدير\n\nيمكنك تصدير الموقع بصيغة Markdown أو PDF. يعمل التصدير لمرة واحدة في الخلفية ويظهر في **الإعدادات ← التصدير** عند اكتماله، ويبقى رابط التنزيل صالحًا لمدة خمس دقائق بعد فتحه. يعمل التصدير المجدول يوميًا أو أسبوعيًا ويحتفظ بآخر سبعة ملفات. يشمل التصدير الصفحات المنشورة فقط وليس المسودات. يجب تصدير المواقع الكبيرة التي تتجاوز 5000 صفحة إصدارًا واحدًا في كل مرة.',
      instruction: 'اكتبه لمالك موقع غير تقني.',
    },
  },
];

let reservedUsd = 0;
const run = async (model: string, body: AiDraftBody) => {
  const { input, output } = price(model);
  // Conservative reservation: every prompt byte as a token, and a long reply with reasoning.
  reservedUsd += (Buffer.byteLength(JSON.stringify(draftMessages(body)), 'utf8') + 200) * input + 6000 * output;
  if (reservedUsd > budget) throw new Error('Draft spend reservation exceeds EVAL_MAX_COST_USD; no request dispatched.');
  const started = performance.now();
  const result = await completeWorkspaceText(
    { providerId: 'openrouter', apiKey, answerModel: model, embeddingModel: '', revision: 'eval', answersEnabled: true },
    draftMessages(body),
    { siteUrl: 'https://nibleaf.com', title: 'Nibleaf draft benchmark' },
    effort,
  );
  return {
    text: result.text.trim(),
    latencyMs: Math.round(performance.now() - started),
    inputTokens: result.promptTokens,
    outputTokens: result.completionTokens,
    // Estimated from catalog prices; OpenRouter counts reasoning in completion tokens.
    costUsd:
      result.promptTokens !== undefined && result.completionTokens !== undefined
        ? result.promptTokens * input + result.completionTokens * output
        : undefined,
  };
};

type Output = Awaited<ReturnType<typeof run>>;
const blind: {
  id: string;
  language: string;
  action: string;
  instruction: string | null;
  input: string;
  prompt: unknown;
  outputs: { A?: Output; B?: Output };
}[] = [];
const key: Record<string, { A: string; B: string }> = {};
// EVAL_LIMIT runs the first items only, for a smoke run.
for (const item of items.slice(0, Number(process.env.EVAL_LIMIT ?? items.length))) {
  const outputs = await Promise.all(models.map((model) => run(model, item.body)));
  // Seeded per item, so a rerun keeps the same order.
  const swap = (createHash('sha256').update(`${seed}:${item.id}`).digest()[0] ?? 0) % 2 === 1;
  const [first, second] = swap ? [1, 0] : [0, 1];
  key[item.id] = { A: models[first] as string, B: models[second] as string };
  blind.push({
    id: item.id,
    language: item.language,
    action: item.body.mode,
    instruction: item.body.instruction ?? null,
    input: item.body.content,
    prompt: draftMessages(item.body),
    outputs: { A: outputs[first], B: outputs[second] },
  });
  console.log(`${item.id}: done`);
}

const summary = models.map((model) => {
  const runs = blind.map((item) => (key[item.id]?.A === model ? item.outputs.A : item.outputs.B));
  const latencies = runs.map((r) => r?.latencyMs ?? 0).sort((a, b) => a - b);
  return {
    model,
    items: runs.length,
    p50LatencyMs: latencies[Math.ceil(latencies.length * 0.5) - 1],
    p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1],
    meanOutputTokens: runs.reduce((sum, r) => sum + (r?.outputTokens ?? 0), 0) / runs.length,
    costUsd: runs.reduce((sum, r) => sum + (r?.costUsd ?? 0), 0),
  };
});
await mkdir(outputDir, { recursive: true });
await writeFile(
  resolve(outputDir, 'drafts-blind.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), seed, effort, items: blind }, null, 2)}\n`,
);
await writeFile(resolve(outputDir, 'drafts-key.json'), `${JSON.stringify({ seed, effort, key }, null, 2)}\n`);
// Per-model speed and cost only; it does not say which label is which.
await writeFile(resolve(outputDir, 'drafts-summary.json'), `${JSON.stringify({ seed, effort, summary }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote drafts-blind.json, drafts-key.json and drafts-summary.json to ${outputDir}`);
