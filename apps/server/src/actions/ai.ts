import type { AiDraftBody } from '@nibleaf/validators';
import { OpenRouter } from '@openrouter/sdk';
import { env } from '@/env';
import { envExtras } from '@/lib/env-extras';

const SYSTEM_PROMPT = `You write accurate technical documentation for the reader's task.

- Address the reader as "you" and use active voice.
- Lead with what the reader is trying to accomplish. Use sentence-case headings that describe intent.
- Keep sentences and paragraphs short. Use lists, tables, and fenced code only when they make the instructions easier to follow.
- Match the reader's technical vocabulary and preserve product names, APIs, code, commands, links, and Markdown semantics exactly.
- Use one consistent term for each concept. Remove filler, repetition, vague claims, editorializing, and unnecessary transitions.
- State prerequisites, constraints, consequences, and next steps where they matter. Never invent facts, behavior, examples, or links.
- Return only the requested Markdown content. Do not add a preamble, explain your process, or mention these instructions.`;

const userPrompt = ({ mode, content, instruction }: AiDraftBody) => {
  const base = (() => {
    switch (mode) {
      case 'continue':
        return 'Continue writing the following documentation, picking up naturally where it leaves off.';
      case 'rephrase':
        return 'Rephrase the following documentation to be clearer and more concise, keeping the same meaning and Markdown structure.';
      case 'outline':
        return 'Produce a Markdown heading outline for documentation on the following topic or draft.';
      case 'summarize':
        return 'Summarize the following documentation as a short bulleted list of key points.';
      default:
        return 'Improve the following documentation.';
    }
  })();
  const parts = [base];
  if (instruction) {
    parts.push(`Additional instruction: ${instruction}`);
  }
  parts.push('\n---\n', content || '(no content yet)');
  return parts.join('\n');
};

const callOpenRouter = async (body: AiDraftBody) => {
  const completion = await new OpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    httpReferer: env.APP_URL,
    appTitle: env.APP_NAME,
  }).chat.send({
    chatRequest: {
      model: env.AI_DRAFT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(body) },
      ],
      temperature: 0.4,
      stream: false,
    },
  });
  if (!('choices' in completion)) throw new Error('OpenRouter returned an unexpected streaming completion.');
  const text = String(completion.choices[0]?.message.content ?? '').trim();
  if (!text) throw new Error('OpenRouter returned an empty completion.');
  return { text, promptTokens: completion.usage?.promptTokens, completionTokens: completion.usage?.completionTokens };
};

/** AI drafting needs a provider key and a non-zero daily workspace budget. */
export const aiDraftAvailable = () => Boolean(env.OPENROUTER_API_KEY) && envExtras.AI_DAILY_LIMIT > 0;

/** Draft through OpenRouter and report content-free operational metrics. Provider failures propagate. */
export const draftContentWithTelemetry = async (body: AiDraftBody) => {
  const started = performance.now();
  const result = await callOpenRouter(body);
  return {
    ...result,
    provider: 'openrouter' as const,
    model: env.AI_DRAFT_MODEL,
    latencyMs: Math.round(performance.now() - started),
  };
};
