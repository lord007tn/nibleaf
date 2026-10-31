import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';

const moduleUrl = (name: string) => JSON.stringify(new URL(name, import.meta.url).href);
const program = String.raw`
import {performance} from 'node:perf_hooks';
import {convertGitBookMarkdown,extractGitBookTitle,expandGitBookIncludes,plainGitBookText} from ${moduleUrl('./gitbook-markdown.ts')};
import {parseGitBookSummary} from ${moduleUrl('./gitbook-mapping.ts')};
import {rewriteGitBookImages} from ${moduleUrl('./gitbook-assets.ts')};
import {rewriteMintlifyInternalLinks} from ${moduleUrl('./mintlify-links.ts')};
import {remoteImageSources} from ${moduleUrl('./import-references.ts')};
import {protectMarkdownCode} from '@nibleaf/shared/markdown-code';
const size=2*1024*1024;
const fill=unit=>unit.repeat(Math.ceil(size/unit.length)).slice(0,size);
const convert=source=>convertGitBookMarkdown(source,{resolveFile:()=>undefined});
const crossed=body=>{const depth=Math.floor(size/5);return '['.repeat(depth)+']('.repeat(depth)+body.repeat(depth)+')'.repeat(depth);};
const cases={
 'page heading':()=>extractGitBookTitle('# '+fill(' ')+'x'),
 'SUMMARY heading':()=>parseGitBookSummary('## '+fill(' ')+'x\n* [Page](page.md)'),
 'step heading':()=>convert('{% step %}\n# '+fill(' ')+'x\nbody\n{% endstep %}'),
 'heading anchor absent':()=>convert('## '+fill(' ')+'x'),
 'heading anchor present':()=>convert('## '+fill(' ')+'<a id="x"></a>'),
 'unfinished Liquid':()=>convert(fill('{% x ')),
 'unfinished Liquid attributes':()=>convert(fill('{% tab title="')),
 'unclosed Liquid steps':()=>convert(fill('{% step %}')),
 'paired Liquid nesting':()=>convert('{% step %}'.repeat(Math.floor(size/23))+'body'+'{% endstep %}'.repeat(Math.floor(size/23))),
 'Liquid attribute word':()=>convert('{% tab '+fill('a')+' %}'),
 'heading anchor attribute run':()=>convert('## <a '+fill('id="')+'> </a>'),
 'unclosed HTML attributes':()=>convert(fill('<a id="')),
 'unterminated labels':()=>rewriteMintlifyInternalLinks(fill('['),'p.md',new Map()),
 'unterminated images':()=>rewriteGitBookImages(fill('!['),'p.md',new Set(),'',()=> ''),
 'remote image labels':()=>remoteImageSources(fill('![')),
 'remote HTML attributes':()=>remoteImageSources(fill('<img src="')),
 'include tokens':()=>expandGitBookIncludes(fill('{% include "'),'p.md',()=>undefined,async()=>null,[]),
 'label comparisons':()=>plainGitBookText(fill('a<b and c>d ')),
 'angle image destinations':()=>rewriteGitBookImages(fill('![a](<b)'),'p.md',new Set(),'',()=> ''),
 'angle link destinations':()=>rewriteMintlifyInternalLinks(fill('[a](<b)'),'p.md',new Map()),
 'angle remote images':()=>remoteImageSources(fill('![a](<b)')),
 'crossed destinations':()=>remoteImageSources(crossed('x')),
 'crossed blank destinations':()=>remoteImageSources(crossed(' ')),
 'escaped image markers':()=>remoteImageSources(fill('\\![a [b](c)](d)')),
 'nested image descriptions':()=>{const depth=Math.floor(size/6);return remoteImageSources('!['.repeat(depth)+'](b)'.repeat(depth));},
 'icon class word':()=>convert('<i class="fa-'+fill('a')),
 'icon class run':()=>convert(fill('<i class="fa-a ')),
 'shared code restore':()=>{const input=fill('\u0060x\u0060 ');const code=protectMarkdownCode(input);if(code.restore(code.content)!==input)throw new Error('restore mismatch');},
 'pipeline code restore':()=>convert(fill('\u0060x\u0060 ')),
};
const started=performance.now();await cases[process.argv[1]]();
console.log(JSON.stringify({elapsed:performance.now()-started}));
`;

const measure = (name: string) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program, name], { cwd: process.cwd(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${name}: measurement deadline exceeded`));
    }, 20_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}').elapsed);
      } catch (error) {
        reject(error);
      }
    });
  });

const cases = [
  'page heading',
  'SUMMARY heading',
  'step heading',
  'heading anchor absent',
  'heading anchor present',
  'unfinished Liquid',
  'unfinished Liquid attributes',
  'unclosed Liquid steps',
  'paired Liquid nesting',
  'Liquid attribute word',
  'heading anchor attribute run',
  'unclosed HTML attributes',
  'unterminated labels',
  'unterminated images',
  'remote image labels',
  'remote HTML attributes',
  'include tokens',
  'label comparisons',
  'angle image destinations',
  'angle link destinations',
  'angle remote images',
  'crossed destinations',
  'crossed blank destinations',
  'escaped image markers',
  'nested image descriptions',
  'icon class word',
  'icon class run',
];
it.skipIf(process.env.GITBOOK_PERFORMANCE !== '1').each(cases)(
  'processes two MiB: %s',
  async (name) => {
    const elapsed = await measure(name);
    console.info(`${name}: ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(3000);
  },
  25_000,
);
it.skipIf(process.env.GITBOOK_PERFORMANCE !== '1').each(['shared code restore', 'pipeline code restore'])(
  'processes two MiB: %s',
  async (name) => {
    const elapsed = await measure(name);
    console.info(`${name}: ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(3000);
  },
  25_000,
);
