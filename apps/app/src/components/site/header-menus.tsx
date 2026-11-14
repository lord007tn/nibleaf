import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { siteT } from '@nibleaf/i18n/site';
import { Bot, Check, Copy, FileText, MessageSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { languageTriggerProps, type SiteLanguage } from '@/components/site/language-switcher';
import { askAiLinks, pageActionsTriggerProps } from '@/components/site/page-actions';
import { activeSiteVersion, type SiteVersion, versionTriggerProps } from '@/components/site/version-switcher';
import type { IntentStart } from '@/lib/intent-module';

/*
 * The header's language and version menus, loaded when a reader reaches for
 * one: until then the header renders their triggers alone (see
 * language-switcher.tsx and lib/intent-module.ts).
 */

/** The real trigger takes focus over from the static one it replaced. */
function useTakeFocus(focusTrigger: boolean) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusTrigger) trigger.current?.focus();
  }, [focusTrigger]);
  return trigger;
}

export function LanguageMenu({
  languages,
  activeCode,
  onChange,
  start,
}: {
  languages: SiteLanguage[];
  activeCode: string;
  onChange: (code: string) => void;
  start: IntentStart;
}) {
  const trigger = useTakeFocus(start.focusTrigger);
  return (
    <DropdownMenu defaultOpen={start.defaultOpen}>
      <DropdownMenuTrigger ref={trigger} render={<button {...languageTriggerProps(languages, activeCode)} />} />
      <DropdownMenuContent align="end" className="w-44">
        {languages.map((language) => (
          <DropdownMenuItem key={language.code} onClick={() => onChange(language.code)} className="pointer-coarse:min-h-11">
            <span className="flex-1" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'} lang={language.code}>
              {language.label}
            </span>
            {language.code === activeCode ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VersionMenu({
  versions,
  activeSlug,
  onChange,
  lang,
  start,
}: {
  versions: SiteVersion[];
  activeSlug: string;
  onChange: (slug: string) => void;
  lang?: string;
  start: IntentStart;
}) {
  const trigger = useTakeFocus(start.focusTrigger);
  const t = siteT(lang);
  const active = activeSiteVersion(versions, activeSlug);
  return (
    <DropdownMenu defaultOpen={start.defaultOpen}>
      <DropdownMenuTrigger ref={trigger} render={<button {...versionTriggerProps(versions, activeSlug, lang)} />} />
      <DropdownMenuContent align="end" className="w-44">
        {versions.map((version) => (
          <DropdownMenuItem key={version.id} onClick={() => onChange(version.slug)} className="pointer-coarse:min-h-11">
            <span className="flex-1 truncate">{version.name}</span>
            {version.isDefault ? <span className="text-[10px] text-muted-foreground">{t('defaultVersion')}</span> : null}
            {version.slug === active?.slug ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page action: an icon, a label and a one-line hint. */
function ActionLabel({ icon: Icon, label, hint }: { icon: typeof Copy; label: string; hint: string }) {
  return (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 self-start" aria-hidden />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </>
  );
}

/** The page actions' menu (page-actions.tsx): copy, plain Markdown, and the page in ChatGPT or Claude. */
export function PageActionsMenu({
  lang,
  markdownHref,
  onCopy,
  start,
}: {
  lang?: string;
  markdownHref: string;
  onCopy: () => void;
  start: IntentStart;
}) {
  const trigger = useTakeFocus(start.focusTrigger);
  const t = siteT(lang);
  const ai = askAiLinks(new URL(markdownHref, window.location.href).toString());
  const item = 'items-start gap-2.5 pointer-coarse:min-h-11';
  return (
    <DropdownMenu defaultOpen={start.defaultOpen}>
      <DropdownMenuTrigger ref={trigger} render={<button {...pageActionsTriggerProps(lang)} />} />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={onCopy} className={item}>
          <ActionLabel icon={Copy} label={t('copyPage')} hint={t('copyPageHint')} />
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={markdownHref} target="_blank" rel="noreferrer" />} className={item}>
          <ActionLabel icon={FileText} label={t('viewMarkdown')} hint={t('viewMarkdownHint')} />
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={ai.chatgpt} target="_blank" rel="noreferrer" />} className={item}>
          <ActionLabel icon={MessageSquare} label={t('openInChatGpt')} hint={t('openInAiHint')} />
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={ai.claude} target="_blank" rel="noreferrer" />} className={item}>
          <ActionLabel icon={Bot} label={t('openInClaude')} hint={t('openInAiHint')} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
