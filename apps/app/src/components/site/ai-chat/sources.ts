import type { AiChatSource } from '@nibleaf/validators';

/** One cited section of a page, with the number the reader sees in the answer. */
export interface CitedSection {
  /** 1-based: sections are numbered in the order the answer first cites them. */
  number: number;
  /** The first citation of this section; its title, heading, anchor and snippet. */
  source: AiChatSource;
}

/** The sections cited from one page, so the page's title is shown once. */
interface SourceGroup {
  /** One page in one language: a translation is another page. */
  key: string;
  title: string;
  direction: AiChatSource['direction'];
  sections: CitedSection[];
}

export interface AnswerSources {
  groups: SourceGroup[];
  /** Every section in number order (number = index + 1). */
  sections: CitedSection[];
  /** The number shown for a citation id (`S3`), or undefined when the answer did not cite it. */
  numberOf: (id: string) => number | undefined;
}

const pageKey = (source: AiChatSource) => JSON.stringify([source.pageId, source.language ?? '']);
/** A section is its page plus its anchor, or its heading when it has no anchor
 * (or neither: the top of the page). Two citations of one section share a number. */
const sectionKey = (source: AiChatSource) => JSON.stringify([source.pageId, source.language ?? '', source.anchor ?? source.heading ?? '']);

/** Numbers an answer's citations by section and groups the sections by page.
 * `citations` is in the order the checked answer first cites them (the server's
 * order), so the numbers read 1, 2, 3 down the answer whatever ids the model used,
 * and pages are listed in the order their first section is cited. */
export function answerSources(citations: readonly AiChatSource[]): AnswerSources {
  const numbers = new Map<string, number>();
  const bySection = new Map<string, CitedSection>();
  const groups = new Map<string, SourceGroup>();
  const sections: CitedSection[] = [];
  for (const source of citations) {
    const key = sectionKey(source);
    let section = bySection.get(key);
    if (!section) {
      section = { number: sections.length + 1, source };
      bySection.set(key, section);
      sections.push(section);
      const page = pageKey(source);
      let group = groups.get(page);
      if (!group) {
        group = { key: page, title: source.title, direction: source.direction, sections: [] };
        groups.set(page, group);
      }
      group.sections.push(section);
    }
    numbers.set(source.id, section.number);
  }
  return { groups: [...groups.values()], sections, numberOf: (id) => numbers.get(id) };
}
