import type { AiDraftBody } from '@nibleaf/validators';
import OpenAI from 'openai';
import { env } from '@/env';

const SYSTEM_PROMPT =
  'You are an expert technical documentation writer. Write clear, concise, accurate Markdown suitable for a developer documentation site. ' +
  'Prefer short paragraphs, fenced code blocks where helpful, and a neutral, professional tone. Return only the requested content, with no preamble or commentary.';

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

const callOpenAI = async (body: AiDraftBody) => {
  const completion = await new OpenAI({ apiKey: env.OPENAI_API_KEY }).chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(body) },
    ],
    temperature: 0.4,
  });
  const text = completion.choices[0]?.message.content?.trim();
  if (!text) {
    throw new Error('OpenAI returned an empty completion.');
  }
  return { text, promptTokens: completion.usage?.prompt_tokens, completionTokens: completion.usage?.completion_tokens };
};

/** Deterministic, offline fallback so the assistant always returns something useful. */
const fallback = ({ mode, content, instruction }: AiDraftBody) => {
  const trimmed = content.trim();
  const hint = instruction ? ` (${instruction})` : '';
  switch (mode) {
    case 'continue':
      return `${trimmed ? `${trimmed}\n\n` : ''}## Next steps${hint}\n\nExpand on the section above with concrete details: explain the why, walk through a short example, and link to related pages so readers can go deeper.`;
    case 'rephrase':
      return `${trimmed || '_No content to rephrase yet._'}\n\n> Note: AI rephrasing is unavailable offline. Tighten the wording above by removing filler and leading with the key point.${hint}`;
    case 'outline':
      return `# ${trimmed ? trimmed.split('\n')[0]?.replace(/^#+\s*/, '') || 'Overview' : 'Overview'}\n\n## Introduction\n\n## Getting started\n\n## Configuration\n\n## Examples\n\n## Troubleshooting\n\n## Reference${hint}`;
    case 'summarize': {
      const lines = trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 5);
      const bullets = lines.length
        ? lines.map((line) => `- ${line.replace(/^#+\s*/, '').slice(0, 120)}`).join('\n')
        : '- No content to summarize yet.';
      return `**Summary**${hint}\n\n${bullets}`;
    }
    default:
      return trimmed;
  }
};

/** Internal variant used by the API to emit content-free operational metrics. */
export const draftContentWithTelemetry = async (body: AiDraftBody) => {
  const started = performance.now();
  if (env.OPENAI_API_KEY) {
    try {
      const result = await callOpenAI(body);
      return {
        ...result,
        provider: 'openai' as const,
        model: 'gpt-4o-mini',
        outcome: 'completed' as const,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch {
      return {
        text: fallback(body),
        promptTokens: undefined,
        completionTokens: undefined,
        provider: 'nibleaf_offline' as const,
        model: 'deterministic-fallback',
        outcome: 'fallback' as const,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
  return {
    text: fallback(body),
    promptTokens: undefined,
    completionTokens: undefined,
    provider: 'nibleaf_offline' as const,
    model: 'deterministic-fallback',
    outcome: 'completed' as const,
    latencyMs: Math.round(performance.now() - started),
  };
};
