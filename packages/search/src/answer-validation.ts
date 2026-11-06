import type { GroundedCitation } from './answer';
import { type SearchChunk, searchChunkSnippet } from './hybrid';

export type CitationPolicy = 'strict' | 'chat';
export type CitedAnswerValidation =
  | { status: 'answered'; answer: string; citations: GroundedCitation[]; droppedParagraphs: number }
  | { status: 'no_answer'; reason: 'unknown_citation' | 'uncited' | 'empty' };

/** Source card for an `S#` id, or undefined when the id names no supplied chunk. */
export const citationFor = (id: string, chunks: SearchChunk[], query: string): GroundedCitation | undefined => {
  const match = id.match(/^S([1-9][0-9]*)$/);
  const chunk = match ? chunks[Number(match[1]) - 1] : undefined;
  if (!chunk) return undefined;
  return {
    id,
    pageId: chunk.pageId,
    title: chunk.title,
    path: chunk.path,
    heading: chunk.heading || undefined,
    snippet: searchChunkSnippet(chunk, query, 260),
    direction: chunk.direction,
  };
};

const idsIn = (text: string) => [...text.matchAll(/\[(S[1-9][0-9]*)\]/g)].map((match) => match[1] as string);

/** Blank lines inside matching Markdown fences do not end a block. */
const markdownBlocks = (text: string): string[] => {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence = '';
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker?.[1]) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
    }
    if (!line.trim() && !fence) {
      if (lines.length) blocks.push(lines.join('\n').trim());
      lines = [];
    } else lines.push(line);
  }
  if (lines.length) blocks.push(lines.join('\n').trim());
  return blocks.filter(Boolean);
};

export const validateCitedAnswer = (answer: string, chunks: SearchChunk[], query: string, policy: CitationPolicy): CitedAnswerValidation => {
  let text = answer.trim();
  if (!text) return { status: 'no_answer', reason: 'empty' };
  if (policy === 'chat')
    text = text.replace(/\[(S\d+(?:\s*[,;،]\s*S\d+)+)\]/g, (_, group: string) =>
      group
        .split(/\s*[,;،]\s*/)
        .map((id) => `[${id}]`)
        .join(''),
    );
  const known = new Set(chunks.map((_, index) => `S${index + 1}`));
  // Include malformed numeric ids (S0, S01) in the unknown-id guard.
  if ([...text.matchAll(policy === 'chat' ? /\[(S\d+)\]/g : /\[(S[1-9][0-9]*)\]/g)].some((match) => !known.has(match[1] ?? '')))
    return { status: 'no_answer', reason: 'unknown_citation' };
  if (!idsIn(text).length) return { status: 'no_answer', reason: 'uncited' };
  let droppedParagraphs = 0;
  if (policy === 'strict') {
    if (
      text
        .split(/\n\s*\n/)
        .filter((block) => block.trim())
        .some((block) => !idsIn(block).length)
    )
      return { status: 'no_answer', reason: 'uncited' };
  } else {
    const blocks = markdownBlocks(text);
    // Disjoint parts keep this linear on long runs of spaces (CodeQL js/polynomial-redos).
    // A short bold line such as "**From the app:**" is a section label, not a
    // claim; models use it in place of a Markdown heading. A bold sentence (ending
    // in . ! ? or ؟) is still a claim. Bounded, so linear.
    const heading = (block: string) =>
      /^#{1,6}[ \t]+\S[^\n]*$/.test(block) || /^(?:\*\*|__)[^\n*_]{0,79}[^\n*_.!?؟](?:\*\*|__):?$/.test(block.trim());
    const code = (block: string) => /^\s*(`{3,}|~{3,})/.test(block);
    const list = (block: string) => /^\s*(?:[-*+]|\d+[.)])\s/.test(block);
    const substantive = blocks.map((block, index) => {
      if (heading(block) || code(block)) return false;
      const next = blocks[index + 1];
      if (block.length <= 200 && block.endsWith(':') && next && (idsIn(next).length || code(next) || list(next))) return false;
      // Models often cite a list of steps in the sentence right after it
      // ("…up to 500 notes. [S1]"). That adjacent citation covers the list.
      if (list(block) && !idsIn(block).length && next && !heading(next) && idsIn(next).length) return false;
      return true;
    });
    // Uncited substantive blocks are removed, never shown; an uncited opening
    // summary is removed like any other. Removals may account for at most one
    // third of substantive blocks (including cited lists), or the answer is
    // withdrawn.
    const kept = blocks.filter((block, index) => {
      if (substantive[index] && !idsIn(block).length) {
        droppedParagraphs++;
        return false;
      }
      return true;
    });
    if (droppedParagraphs > substantive.filter(Boolean).length / 3) return { status: 'no_answer', reason: 'uncited' };
    while (kept.length && heading(kept.at(-1) ?? '') && !idsIn(kept.at(-1) ?? '').length) kept.pop();
    text = kept.join('\n\n');
  }
  const citations = [...new Set(idsIn(text))].flatMap((id) => citationFor(id, chunks, query) ?? []);
  return { status: 'answered', answer: text, citations, droppedParagraphs };
};
