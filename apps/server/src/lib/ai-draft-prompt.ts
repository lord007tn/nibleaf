import type { AiDraftBody } from '@nibleaf/validators';

/** The editor's writing actions. Kept free of server configuration so the
 * draft benchmark (src/scripts/evaluate-drafts.ts) sends exactly these prompts. */
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

export const draftMessages = (body: AiDraftBody): Array<{ role: 'system' | 'user'; content: string }> => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userPrompt(body) },
];
