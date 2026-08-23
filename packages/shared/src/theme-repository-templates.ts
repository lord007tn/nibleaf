import type { ThemePresetId } from './themes';

export interface ThemeRepositoryTemplateSource {
  componentName: 'HarborTheme' | 'ManuscriptTheme' | 'SignalTheme';
  displayName: 'Harbor' | 'Manuscript' | 'Signal';
  accent: string;
  source: string;
  style: string;
}

export const themeUtilitiesSource = `import { useEffect } from 'react';
import type { SitePage } from '../nibleaf/runtime';

export const visibleDocumentationPages = (pages: SitePage[]): SitePage[] => pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
export const chromeLocale = (languageCode: string | undefined): 'en' | 'ar' => languageCode === 'ar' ? 'ar' : 'en';

export const useDocumentLanguage = (languageCode: string | undefined, direction: 'LTR' | 'RTL' | undefined): void => {
  useEffect(() => {
    if (!languageCode || !direction) return;
    document.documentElement.lang = languageCode;
    document.documentElement.dir = direction === 'RTL' ? 'rtl' : 'ltr';
  }, [direction, languageCode]);
};
`;

const harborSource = `import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, useDocumentLanguage, visibleDocumentationPages } from './theme-utils';

export function HarborTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const visiblePages = useMemo(() => visibleDocumentationPages(snapshot.pages), [snapshot.pages]);
  const [activeId, setActiveId] = useState(visiblePages[0]?.id);
  const page = visiblePages.find((item) => item.id === activeId) ?? visiblePages[0];
  const language = snapshot.project.languages.find((item) => item.code === page?.languageCode) ?? snapshot.project.languages[0];
  const locale = chromeLocale(language?.code);
  useDocumentLanguage(language?.code, language?.direction);
  if (!page || !language) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  const version = snapshot.project.versions.find((item) => item.id === page.versionId)?.name;
  return (
    <div className="harbor" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <a className="brand" href="/">{snapshot.project.name}<span>{m.themeLabel({}, { locale })}</span></a>
        <div className="search" aria-label={m.search({}, { locale })}><Search aria-hidden="true" size={16} /><span>{m.search({}, { locale })}</span></div>
        <a className="github" href="https://github.com" rel="noreferrer"><span>{m.github({}, { locale })}</span><ExternalLink aria-hidden="true" size={14} /></a>
      </header>
      <aside className="sidebar">
        <p className="eyebrow">{m.documentation({}, { locale })}</p>
        <nav aria-label={m.documentation({}, { locale })}>{visiblePages.map((item) => <PageLink active={item.id === page.id} key={item.id} onSelect={() => setActiveId(item.id)} page={item} />)}</nav>
        <div className="extension"><strong>{m.customerOwned({}, { locale })}</strong><p>{m.edit({}, { locale })} <code>src/theme/HarborTheme.tsx</code>. {m.syncPreserves({}, { locale })}</p></div>
      </aside>
      <main className="article">
        <label className="mobile-page-picker">
          <span>{m.page({}, { locale })}</span>
          <select aria-label={m.choosePage({}, { locale })} onChange={(event) => setActiveId(event.target.value)} value={page.id}>
            {visiblePages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <p className="eyebrow">{language.label} · {version}</p>
        <h1>{page.title}</h1>
        {page.description ? <p className="lede">{page.description}</p> : null}
        <article className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown></article>
      </main>
      <aside className="toc"><p className="eyebrow">{m.onThisPage({}, { locale })}</p><a href="#overview">{m.overview({}, { locale })}</a><a href="#next-steps">{m.nextSteps({}, { locale })}</a></aside>
    </div>
  );
}

function PageLink({ active, onSelect, page }: { active: boolean; onSelect(): void; page: SitePage }) {
  return <button className={active ? 'nav-link active' : 'nav-link'} onClick={onSelect} type="button">{page.title}</button>;
}
`;

const harborStyle = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182132;background:#fbfcfe;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.harbor{display:grid;min-height:100vh;grid-template-columns:17rem minmax(0,1fr) 13rem;grid-template-rows:4.25rem auto;grid-template-areas:"top top top" "side article toc"}.topbar{grid-area:top;position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:2rem;padding:0 2rem;border-bottom:1px solid #dce3ec;background:rgba(251,252,254,.92);backdrop-filter:blur(14px)}.brand{font-weight:760;color:#142038;text-decoration:none;font-size:1.05rem}.brand span{margin-inline-start:.65rem;border-radius:999px;background:#e7f7f3;color:#087866;padding:.22rem .55rem;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase}.search{margin-inline:auto;display:flex;width:min(28rem,40vw);align-items:center;gap:.55rem;padding:.68rem 1rem;border:1px solid #d8e0e9;border-radius:.7rem;background:#fff;color:#718096;font-size:.86rem;box-shadow:0 1px 2px rgba(30,45,68,.04)}.github{display:flex;align-items:center;gap:.35rem;color:#31506f;text-decoration:none;font-size:.86rem}.sidebar{grid-area:side;padding:2rem 1.4rem;border-inline-end:1px solid #e2e8f0;background:#f7f9fc}.eyebrow{margin:0 0 .9rem;color:#75859a;font-size:.72rem;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.nav-link{display:block;width:100%;margin:.18rem 0;padding:.68rem .8rem;border:0;border-radius:.55rem;background:transparent;color:#52647b;text-align:start;cursor:pointer}.nav-link:hover,.nav-link.active{background:#e5f5f1;color:#087866;font-weight:650}.extension{margin-top:2rem;padding:1rem;border:1px solid #cfe3df;border-radius:.75rem;background:#effaf7;font-size:.75rem;line-height:1.5;color:#385d58}.extension p{margin:.4rem 0 0}.article{grid-area:article;width:min(100%,52rem);padding:4rem 4.5rem 6rem}.mobile-page-picker{display:none}.article h1{margin:.25rem 0 .8rem;color:#111b2d;font-size:clamp(2.2rem,5vw,3.8rem);line-height:1.04;letter-spacing:-.045em}.lede{max-width:44rem;color:#617188;font-size:1.18rem;line-height:1.7}.prose{margin-top:2.8rem;color:#33445b;font-size:1rem;line-height:1.8}.prose h2{margin-top:2.6rem;color:#17243a;font-size:1.5rem}.prose code{padding:.15rem .35rem;border-radius:.3rem;background:#edf2f7;color:#087866}.prose pre{overflow:auto;padding:1.1rem;border-radius:.8rem;background:#101827;color:#dbeafe}.toc{grid-area:toc;padding:4rem 1.2rem}.toc a{display:block;margin:.65rem 0;color:#6a7b91;text-decoration:none;font-size:.82rem}.loading,.empty{padding:3rem}@media(max-width:900px){.harbor{grid-template-columns:1fr;grid-template-areas:"top" "article";grid-template-rows:4rem auto}.topbar{padding:0 1rem}.search,.github,.sidebar,.toc{display:none}.article{padding:2.5rem 1.25rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:1.4rem;color:#52647b;font-size:.75rem;font-weight:650}.mobile-page-picker select{width:100%;padding:.72rem .8rem;border:1px solid #d8e0e9;border-radius:.6rem;background:#fff;color:#182132}.article h1{font-size:2.35rem}}
`;

const manuscriptSource = `import { BookOpen, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, useDocumentLanguage, visibleDocumentationPages } from './theme-utils';

export function ManuscriptTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const visiblePages = useMemo(() => visibleDocumentationPages(snapshot.pages), [snapshot.pages]);
  const [activeId, setActiveId] = useState(visiblePages[0]?.id);
  const page = visiblePages.find((item) => item.id === activeId) ?? visiblePages[0];
  const language = snapshot.project.languages.find((item) => item.code === page?.languageCode) ?? snapshot.project.languages[0];
  const locale = chromeLocale(language?.code);
  useDocumentLanguage(language?.code, language?.direction);
  if (!page || !language) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  const version = snapshot.project.versions.find((item) => item.id === page.versionId)?.name;
  return (
    <div className="manuscript" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="masthead">
        <a className="wordmark" href="/"><BookOpen aria-hidden="true" size={20} /><span>{snapshot.project.name}</span><small>{m.themeLabel({}, { locale })}</small></a>
        <div className="masthead-actions"><span><Search aria-hidden="true" size={15} />{m.search({}, { locale })}</span><a href="https://github.com" rel="noreferrer">{m.github({}, { locale })}<ExternalLink aria-hidden="true" size={13} /></a></div>
      </header>
      <nav aria-label={m.chapters({}, { locale })} className="chapter-deck">
        <strong>{m.chapters({}, { locale })}</strong>
        {visiblePages.map((item, index) => <button className={item.id === page.id ? 'chapter active' : 'chapter'} key={item.id} onClick={() => setActiveId(item.id)} type="button"><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}
      </nav>
      <div className="paper">
        <aside className="margin-notes"><p>{m.onThisPage({}, { locale })}</p><a href="#overview">{m.overview({}, { locale })}</a><a href="#next-steps">{m.nextSteps({}, { locale })}</a></aside>
        <main className="article">
          <label className="mobile-page-picker"><span>{m.page({}, { locale })}</span><select aria-label={m.choosePage({}, { locale })} onChange={(event) => setActiveId(event.target.value)} value={page.id}>{visiblePages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <p className="kicker">{language.label} · {version}</p>
          <h1>{page.title}</h1>
          {page.description ? <p className="dek">{page.description}</p> : null}
          <div className="rule" />
          <article className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown></article>
          <footer className="extension"><strong>{m.customerOwned({}, { locale })}</strong><span>{m.edit({}, { locale })} <code>src/theme/ManuscriptTheme.tsx</code>. {m.syncPreserves({}, { locale })}</span></footer>
        </main>
      </div>
    </div>
  );
}
`;

const manuscriptStyle = `:root{font-family:Georgia,'Times New Roman',serif;color:#29251f;background:#eee9df;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.manuscript{min-height:100vh;padding:1.5rem;background:linear-gradient(135deg,#eee9df,#f7f4ed)}.masthead{display:flex;align-items:center;justify-content:space-between;max-width:82rem;margin:auto;padding:1rem 1.3rem;border:1px solid #cfc5b4;border-bottom:0;background:#fffdf8}.wordmark{display:flex;align-items:center;gap:.65rem;color:#28231d;text-decoration:none;font-family:Inter,ui-sans-serif,sans-serif;font-weight:750}.wordmark small{padding-inline-start:.7rem;border-inline-start:1px solid #cfc5b4;color:#8b6548;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase}.masthead-actions{display:flex;align-items:center;gap:1.2rem;font-family:Inter,ui-sans-serif,sans-serif;color:#746b60;font-size:.78rem}.masthead-actions span,.masthead-actions a{display:flex;align-items:center;gap:.4rem;color:inherit;text-decoration:none}.chapter-deck{display:flex;align-items:stretch;max-width:82rem;margin:auto;overflow:auto;border:1px solid #cfc5b4;background:#f7f2e8;font-family:Inter,ui-sans-serif,sans-serif}.chapter-deck>strong{display:flex;align-items:center;padding:0 1.2rem;color:#8b6548;font-size:.67rem;letter-spacing:.12em;text-transform:uppercase}.chapter{display:flex;min-width:11rem;align-items:center;gap:.55rem;padding:.9rem 1rem;border:0;border-inline-start:1px solid #d9d0c1;background:transparent;color:#675f55;text-align:start;cursor:pointer}.chapter span{color:#a2907c;font-size:.68rem}.chapter.active{background:#fffdf8;color:#34291e;font-weight:700}.paper{display:grid;max-width:82rem;min-height:calc(100vh - 9rem);margin:auto;grid-template-columns:12rem minmax(0,46rem);justify-content:center;border:1px solid #cfc5b4;border-top:0;background:#fffdf8;box-shadow:0 25px 70px rgba(74,58,38,.12)}.margin-notes{padding:5.7rem 1.5rem;border-inline-end:1px solid #e0d8ca;font-family:Inter,ui-sans-serif,sans-serif}.margin-notes p,.kicker{color:#9a6a46;font-family:Inter,ui-sans-serif,sans-serif;font-size:.68rem;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.margin-notes a{display:block;margin:.8rem 0;color:#776b5d;text-decoration:none;font-size:.8rem}.article{min-width:0;padding:5.5rem 4.5rem 7rem}.article h1{max-width:42rem;margin:.5rem 0 1rem;font-size:clamp(2.8rem,6vw,5.4rem);font-weight:500;line-height:.98;letter-spacing:-.045em}.dek{max-width:38rem;color:#6b6257;font-size:1.25rem;font-style:italic;line-height:1.65}.rule{width:5rem;height:2px;margin:2.6rem 0;background:#9a6a46}.prose{font-size:1.06rem;line-height:1.9}.prose h2{margin-top:2.7rem;font-size:1.65rem;font-weight:500}.prose code{padding:.15rem .35rem;background:#f0eadf;color:#7c4f31}.prose pre{max-width:100%;overflow:auto;padding:1.2rem;background:#28231d;color:#f9f3e9;font-family:ui-monospace,monospace}.extension{display:grid;gap:.35rem;margin-top:4rem;padding-top:1.2rem;border-top:1px solid #ddd3c4;color:#766b5e;font-family:Inter,ui-sans-serif,sans-serif;font-size:.75rem}.mobile-page-picker{display:none}.empty{padding:3rem}@media(max-width:850px){.manuscript{padding:0}.masthead{border-inline:0}.masthead-actions{display:none}.chapter-deck,.margin-notes{display:none}.paper{display:block;border-inline:0}.article{padding:3rem 1.35rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:2rem;color:#8b6548;font-family:Inter,ui-sans-serif,sans-serif;font-size:.75rem}.mobile-page-picker select{width:100%;padding:.75rem;border:1px solid #cfc5b4;background:#fffdf8}.article h1{font-size:3.1rem}}
`;

const signalSource = `import { ExternalLink, Search, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, useDocumentLanguage, visibleDocumentationPages } from './theme-utils';

export function SignalTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const visiblePages = useMemo(() => visibleDocumentationPages(snapshot.pages), [snapshot.pages]);
  const [activeId, setActiveId] = useState(visiblePages[0]?.id);
  const page = visiblePages.find((item) => item.id === activeId) ?? visiblePages[0];
  const language = snapshot.project.languages.find((item) => item.code === page?.languageCode) ?? snapshot.project.languages[0];
  const locale = chromeLocale(language?.code);
  useDocumentLanguage(language?.code, language?.direction);
  if (!page || !language) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  const version = snapshot.project.versions.find((item) => item.id === page.versionId)?.name;
  return (
    <div className="signal" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="command-bar">
        <a className="brand" href="/"><Terminal aria-hidden="true" size={18} /><span>{snapshot.project.name}</span><small>{m.themeLabel({}, { locale })}</small></a>
        <div className="search" aria-label={m.search({}, { locale })}><Search aria-hidden="true" size={15} /><span>{m.search({}, { locale })}</span></div>
        <a className="github" href="https://github.com" rel="noreferrer">{m.github({}, { locale })}<ExternalLink aria-hidden="true" size={13} /></a>
      </header>
      <div className="workspace">
        <aside className="rail">
          <p>{m.documentation({}, { locale })}</p>
          <nav aria-label={m.documentation({}, { locale })}>{visiblePages.map((item, index) => <RailLink active={item.id === page.id} index={index} key={item.id} onSelect={() => setActiveId(item.id)} page={item} />)}</nav>
          <div className="extension"><strong>{m.customerOwned({}, { locale })}</strong><span>{m.edit({}, { locale })} <code>src/theme/SignalTheme.tsx</code>. {m.syncPreserves({}, { locale })}</span></div>
        </aside>
        <main className="canvas">
          <label className="mobile-page-picker"><span>{m.page({}, { locale })}</span><select aria-label={m.choosePage({}, { locale })} onChange={(event) => setActiveId(event.target.value)} value={page.id}>{visiblePages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <div className="command-index"><strong>{m.commandIndex({}, { locale })}</strong><a href="#overview">01 {m.overview({}, { locale })}</a><a href="#next-steps">02 {m.nextSteps({}, { locale })}</a></div>
          <section className="panel">
            <p className="status"><span />{language.label} / {version}</p>
            <h1>{page.title}</h1>
            {page.description ? <p className="lede">{page.description}</p> : null}
            <article className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown></article>
          </section>
        </main>
      </div>
    </div>
  );
}

function RailLink({ active, index, onSelect, page }: { active: boolean; index: number; onSelect(): void; page: SitePage }) {
  return <button className={active ? 'rail-link active' : 'rail-link'} onClick={onSelect} type="button"><span>{String(index + 1).padStart(2, '0')}</span>{page.title}</button>;
}
`;

const signalStyle = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e9efff;background:#080b12;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.signal{min-height:100vh;padding:1rem;background:#080b12}.command-bar{display:flex;height:3.75rem;align-items:center;gap:1.5rem;max-width:100rem;margin:auto;border:1px solid #303747;background:#111621;padding:0 1.1rem}.brand{display:flex;align-items:center;gap:.55rem;color:#f1f5ff;text-decoration:none;font-weight:720}.brand small{padding:.18rem .45rem;border:1px solid #506078;color:#91d7ff;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase}.search{display:flex;align-items:center;gap:.5rem;margin-inline:auto;width:min(26rem,36vw);padding:.55rem .75rem;border:1px solid #323b4c;background:#0a0e17;color:#8592a8;font-family:ui-monospace,monospace;font-size:.76rem}.github{display:flex;align-items:center;gap:.35rem;color:#aebbd1;text-decoration:none;font-family:ui-monospace,monospace;font-size:.72rem}.workspace{display:grid;max-width:100rem;min-height:calc(100vh - 5.75rem);margin:auto;grid-template-columns:14.5rem minmax(0,1fr);border:1px solid #303747;border-top:0;background:#f7f9fd}.rail{display:flex;flex-direction:column;padding:1rem;border-inline-end:1px solid #303747;background:#0e131d;color:#c6d0e0}.rail>p,.command-index>strong{color:#718099;font-family:ui-monospace,monospace;font-size:.65rem;letter-spacing:.11em;text-transform:uppercase}.rail-link{display:grid;width:100%;grid-template-columns:2rem 1fr;gap:.35rem;margin:.15rem 0;padding:.68rem .55rem;border:1px solid transparent;background:transparent;color:#9daabc;text-align:start;cursor:pointer;font-size:.78rem}.rail-link span{color:#536078;font-family:ui-monospace,monospace}.rail-link:hover,.rail-link.active{border-color:#39465b;background:#182131;color:#91d7ff}.extension{display:grid;gap:.45rem;margin-top:auto;padding:1rem;border:1px solid #344157;background:#121a27;color:#91a0b7;font-size:.68rem;line-height:1.5}.extension strong{color:#91d7ff}.canvas{padding:1.5rem 2rem 4rem;color:#172033}.command-index{display:flex;align-items:center;gap:1.2rem;padding:.8rem 1rem;border:1px solid #cad3df;background:#edf2f8}.command-index a{color:#4f6076;text-decoration:none;font-family:ui-monospace,monospace;font-size:.7rem}.panel{margin-top:1rem;padding:3rem 3.5rem 5rem;border:1px solid #cad3df;background:#fff;box-shadow:0 18px 50px rgba(25,37,55,.09)}.status{display:flex;align-items:center;gap:.5rem;color:#5f7087;font-family:ui-monospace,monospace;font-size:.68rem;text-transform:uppercase}.status span{width:.5rem;height:.5rem;border-radius:50%;background:#2acb8b;box-shadow:0 0 0 3px #d9f7ea}.panel h1{max-width:58rem;margin:1rem 0;font-size:clamp(2.6rem,5vw,4.7rem);line-height:1;letter-spacing:-.05em}.lede{max-width:52rem;color:#5f6e82;font-size:1.15rem;line-height:1.65}.prose{max-width:64rem;margin-top:3rem;line-height:1.75}.prose h2{margin-top:2.8rem;padding-bottom:.55rem;border-bottom:1px solid #dce2ea;font-family:ui-monospace,monospace;font-size:1.25rem}.prose code{padding:.15rem .35rem;background:#e8f7ff;color:#08779d}.prose pre{overflow:auto;padding:1.2rem;border:1px solid #303747;background:#0d121c;color:#d9e4f7}.mobile-page-picker{display:none}.empty{padding:3rem}@media(max-width:850px){.signal{padding:0}.command-bar{border-inline:0}.search,.github{display:none}.workspace{display:block;border-inline:0}.rail,.command-index{display:none}.canvas{padding:1rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:1rem;color:#52647b;font-size:.75rem}.mobile-page-picker select{width:100%;padding:.72rem;border:1px solid #cad3df;background:#fff}.panel{margin:0;padding:2.5rem 1.25rem 4rem}.panel h1{font-size:2.65rem}}
`;

export const THEME_REPOSITORY_TEMPLATE_SOURCES: Record<ThemePresetId, ThemeRepositoryTemplateSource> = {
  harbor: { componentName: 'HarborTheme', displayName: 'Harbor', accent: '#087866', source: harborSource, style: harborStyle },
  manuscript: { componentName: 'ManuscriptTheme', displayName: 'Manuscript', accent: '#8b6548', source: manuscriptSource, style: manuscriptStyle },
  signal: { componentName: 'SignalTheme', displayName: 'Signal', accent: '#4bb8e8', source: signalSource, style: signalStyle },
};
