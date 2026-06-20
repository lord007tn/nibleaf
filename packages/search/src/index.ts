import { create, insertMultiple, search, type Orama } from '@orama/orama';
import { keys } from './keys';

/** A single searchable documentation page. */
export interface SearchDoc {
  id: string;
  title: string;
  path: string;
  description: string;
  headings: string;
  content: string;
  icon?: string;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  description: string;
  icon?: string;
  snippet: string;
  score: number;
}

const docSchema = {
  title: 'string',
  path: 'string',
  description: 'string',
  headings: 'string',
  content: 'string',
  icon: 'string',
} as const;

export type DocIndex = Orama<typeof docSchema>;

/** Build an in-memory Orama index from a set of documentation pages. */
export const createDocIndex = async (docs: SearchDoc[]): Promise<DocIndex> => {
  const db = (await create({ schema: docSchema })) as DocIndex;
  if (docs.length > 0) {
    await insertMultiple(
      db,
      docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        path: doc.path,
        description: doc.description,
        headings: doc.headings,
        content: doc.content,
        icon: doc.icon ?? '',
      })),
    );
  }
  return db;
};

export interface SearchOptions {
  limit?: number;
  tolerance?: number;
}

/** Full-text + fuzzy search over a doc index, title/heading-boosted, with snippets. */
export const searchDocs = async (db: DocIndex, term: string, options: SearchOptions = {}): Promise<SearchHit[]> => {
  const query = term.trim();
  if (!query) {
    return [];
  }
  const tolerance = options.tolerance ?? keys().SEARCH_FUZZY_TOLERANCE;
  const results = await search(db, {
    term: query,
    properties: ['title', 'headings', 'description', 'content'],
    tolerance,
    boost: { title: 4, headings: 2, description: 1.5 },
    limit: options.limit ?? 12,
  });

  return results.hits.map((hit) => {
    const doc = hit.document as unknown as SearchDoc;
    return {
      id: String(doc.id),
      title: doc.title,
      path: doc.path,
      description: doc.description,
      icon: doc.icon || undefined,
      snippet: makeSnippet(doc.content, query),
      score: hit.score,
    };
  });
};

const SNIPPET_RADIUS = 90;

/** Build a short snippet centered on the first occurrence of the query. */
function makeSnippet(content: string, query: string): string {
  const haystack = content.replace(/\s+/g, ' ').trim();
  const idx = haystack.toLowerCase().indexOf(query.toLowerCase().split(' ')[0] ?? '');
  if (idx === -1) {
    return haystack.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, idx + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
}
