import { readFile } from 'node:fs/promises';
import { QdrantClient } from '@nibleaf/qdrant';
import {
  chunkSearchDocument,
  collapseChunkHits,
  rerankHybridChunks,
  type SearchChunk,
  type SearchScope,
  sparseVectorForChunk,
  sparseVectorForQuery,
  streamGroundedChat,
} from '@nibleaf/search';
import { fakeText } from '@tanstack/ai/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import retrievalFixtures from '../../../../../packages/search/eval/retrieval-fixtures.json';

// Provider-free retrieval evaluation against a real indexed bilingual,
// multi-version fixture site. Fixed dense vectors deliberately provide no
// semantic advantage: sparse retrieval and reranking must find the guide.
const url = process.env.QDRANT_INTEGRATION_URL;
const alias = `nibleaf_retrieval_${process.pid}_${Date.now()}`;
const client = url ? new QdrantClient({ url, alias, schemaVersion: 'v1', vectorSize: 4 }) : null;
const scope = (language: string, versionSlug = 'main'): SearchScope => ({
  projectId: alias,
  deploymentId: 'fixture',
  versionSlug,
  language,
  visibility: 'public',
  allowedPageIds: null,
});
const chunks = new Map<string, SearchChunk>();

describe.skipIf(!client)('indexed documentation retrieval and chat', () => {
  beforeAll(async () => {
    if (!client) throw new Error('QDRANT_INTEGRATION_URL is required');
    await client.ensureHybridCollection();
    for (const language of ['en', 'ar']) {
      const prefix = language === 'ar' ? 'ar/' : '';
      for (const path of ['self-hosting/upgrade-v0-2', 'getting-started/cloud', 'reference/api']) {
        const markdown = await readFile(new URL(`../../../../../docs/${prefix}${path}.mdx`, import.meta.url), 'utf8');
        const title = /^title: ['"](.+)['"]$/m.exec(markdown)?.[1] ?? path;
        for (const version of ['main', 'v2']) {
          const s = scope(language, version);
          const indexed = chunkSearchDocument(s, {
            id: `${language}-${version}-${path}`,
            path,
            title,
            description: '',
            headings: [],
            content: markdown.replace(/^---[\s\S]*?---/u, ''),
            language,
            visible: true,
          });
          for (const chunk of indexed) chunks.set(chunk.id, chunk);
          await client.upsert(
            indexed.map((chunk) => ({
              id: chunk.id,
              vector: { dense: [1, 0, 0, 0], bm25: sparseVectorForChunk(chunk) },
              payload: {
                project_id: alias,
                deployment_id: 'fixture',
                version_slug: version,
                language,
                visibility: 'public',
                visible: true,
                page_id: chunk.pageId,
                ordinal: chunk.ordinal,
                content_hash: chunk.contentHash,
              },
            })),
          );
        }
      }
    }
  }, 30_000);
  afterAll(async () => {
    if (client) await client.dropVersionedCollection();
  });

  it.each(retrievalFixtures as [string, string, string][])(
    'retrieves the guide in the top three for %s / %s / %s',
    async (language, version, query) => {
      if (!client) throw new Error('missing client');
      const filter = {
        must: Object.entries({
          project_id: alias,
          deployment_id: 'fixture',
          version_slug: version,
          language,
          visibility: 'public',
          visible: true,
        }).map(([key, value]) => ({ key, match: { value } })),
      };
      const points = await client.queryHybrid({
        dense: [1, 0, 0, 0],
        sparse: sparseVectorForQuery(query, language),
        filter,
        idfCorpus: filter,
        limit: 48,
        candidateLimit: 48,
        denseScoreThreshold: 0.35,
      });
      const ranked = rerankHybridChunks(
        query,
        points.flatMap((point) => {
          const chunk = chunks.get(String(point.id));
          return chunk ? [{ chunk, score: point.score }] : [];
        }),
      );
      expect(collapseChunkHits(ranked, 3, query).map((hit) => hit.path)).toContain('self-hosting/upgrade-v0-2');
      expect(ranked.every((hit) => hit.chunk.language === language && hit.chunk.pageId.includes(`-${version}-`))).toBe(true);
      const source = ranked[0]?.chunk;
      if (!source) throw new Error('no indexed sources');
      const adapter = fakeText();
      adapter.setResponses([{ text: language === 'ar' ? 'اتبع دليل الترقية. [S1]' : 'Follow the upgrade guide. [S1]' }]);
      const response = streamGroundedChat({ adapter, model: 'fixture', question: query, history: [], chunks: [source], language });
      for await (const _delta of response.deltas) {
        /* drain the real answer pipeline */
      }
      expect(await response.result).toMatchObject({ status: 'answered', citations: [{ pageId: source.pageId }] });
    },
  );
});
