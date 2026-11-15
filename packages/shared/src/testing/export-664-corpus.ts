import manifest from '../__fixtures__/markdown-export.664.corpus.json';
import { markdownCorpus } from './markdown-corpus';

/** Keep the approved 364-page benchmark reproducible as documentation grows.
 * Additional pages remain subject to the same safety/preservation guard. */
export const export664Corpus = (root: string) => {
  const current = markdownCorpus(root);
  const byName = new Map(current);
  const names = new Set(manifest.names);
  const approved = manifest.names.map((name): [string, string] => {
    const source = byName.get(name);
    if (source === undefined) throw new Error(`Missing approved export corpus page: ${name}`);
    return [name, source];
  });
  return { approved, additional: current.filter(([name]) => !names.has(name)) };
};
