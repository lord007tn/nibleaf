import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { joinPath, slugifyUnicode, truncateText } from '@nibleaf/shared/utils';
import { useStore } from '@tanstack/react-form';
import { ChevronRight, CirclePlus, type LucideIcon, PanelsTopLeft, SearchCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import type { PageConfig, PageNode } from '@/hooks/api';
import { friendlyErrorMessage, useReorderPages, useUpdatePage } from '@/hooks/api';
import { usePageSearchDescription } from '@/hooks/api/page-search-description';
import { deepEqual } from '@/lib/forms/server-draft';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';

type PageMode = 'default' | 'wide' | 'center';
type PageSettingsSection = 'general' | 'seo' | 'behaviour';

const PAGE_SETTINGS_SECTIONS = [
  { id: 'general', labelKey: 'editor.pageSettings.tab.general', icon: CirclePlus },
  { id: 'seo', labelKey: 'editor.pageSettings.tab.seo', icon: SearchCheck },
  { id: 'behaviour', labelKey: 'editor.pageSettings.tab.behaviour', icon: PanelsTopLeft },
] as const satisfies ReadonlyArray<{ id: PageSettingsSection; labelKey: MessageKey; icon: LucideIcon }>;

const PLACEHOLDER_SLUG_RE = /^(?:untitled|new-group)(?:-\d+)?$/;

/** The dialog's editable values: what the fields hold, as text and flags. */
type PageSettingsValues = {
  title: string;
  slug: string;
  icon: string;
  description: string;
  hidden: boolean;
  sidebarTitle: string;
  tag: string;
  tags: string;
  category: string;
  categoryIcon: string;
  categoryOrder: string;
  metaTitle: string;
  metaDescription: string;
  ogImage: string;
  canonicalUrl: string;
  noindex: boolean;
  translationKey: string;
  mode: PageMode;
  hideToc: boolean;
};

const pageSettingsValues = (page: PageNode): PageSettingsValues => ({
  title: page.title,
  slug: page.slug,
  icon: page.icon ?? '',
  description: page.description ?? '',
  hidden: page.hidden,
  sidebarTitle: page.config?.sidebarTitle ?? '',
  tag: page.config?.tag ?? '',
  tags: (page.config?.tags ?? []).join(', '),
  category: page.config?.category ?? '',
  categoryIcon: page.config?.categoryIcon ?? '',
  categoryOrder: page.config?.categoryOrder?.toString() ?? '',
  metaTitle: page.config?.seo?.metaTitle ?? '',
  metaDescription: page.config?.seo?.metaDescription ?? '',
  ogImage: page.config?.seo?.ogImage ?? '',
  canonicalUrl: page.config?.seo?.canonicalUrl ?? '',
  noindex: page.config?.seo?.noindex ?? false,
  translationKey: page.translationKey ?? '',
  mode: page.config?.mode ?? 'default',
  hideToc: page.config?.hideToc ?? false,
});

/** The update request for a set of values. A complete config object, so the
 *  server merge replaces every managed key (empty strings/false read as "no
 *  override" via the SEO fallback chain, and blanking a field clears it). When
 *  nothing is overridden it sends null, so the page's config stays null instead
 *  of bloating with an empty object. */
const pageSettingsBody = (values: PageSettingsValues) => {
  const { title, slug, icon, description, hidden, sidebarTitle, tag, tags, category, categoryIcon, categoryOrder } = values;
  const { metaTitle, metaDescription, ogImage, canonicalUrl, noindex, translationKey, mode, hideToc } = values;
  const parsedTags = [
    ...new Set(
      tags
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);
  const parsedCategoryOrder = categoryOrder.trim() === '' ? undefined : Number(categoryOrder);
  const config: PageConfig = {
    sidebarTitle: sidebarTitle.trim(),
    tag: tag.trim(),
    tags: parsedTags,
    category: category.trim(),
    categoryIcon: categoryIcon.trim(),
    ...(Number.isInteger(parsedCategoryOrder) ? { categoryOrder: parsedCategoryOrder } : {}),
    mode,
    hideToc,
    seo: {
      metaTitle: metaTitle.trim(),
      metaDescription: metaDescription.trim(),
      ogImage: ogImage.trim(),
      canonicalUrl: canonicalUrl.trim(),
      noindex,
    },
  };
  const hasOverride =
    sidebarTitle.trim() !== '' ||
    tag.trim() !== '' ||
    parsedTags.length > 0 ||
    category.trim() !== '' ||
    categoryIcon.trim() !== '' ||
    Number.isInteger(parsedCategoryOrder) ||
    mode !== 'default' ||
    hideToc ||
    [metaTitle, metaDescription, ogImage, canonicalUrl].some((v) => v.trim() !== '') ||
    noindex;
  return {
    title: title.trim(),
    slug: slug.trim() || title.trim(),
    icon: icon.trim() || null,
    description: description.trim() || null,
    hidden,
    translationKey: translationKey.trim() || null,
    config: hasOverride ? config : null,
  };
};

/** Per-page settings — General (nav metadata), SEO override, and Behaviour
 *  (layout). The SEO + behaviour fields persist to `page.config`, layered over
 *  the language and site defaults on the published site. */
export function PageSettingsDialog({
  projectId,
  page,
  open,
  onOpenChange,
  published = false,
  languages = [],
  pages = [],
}: {
  projectId: string;
  page: PageNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page is live for readers, so changing its address breaks old links. */
  published?: boolean;
  /** The site's languages, in sidebar order, for moving the page to another one. */
  languages?: ReadonlyArray<{ id: string; label: string }>;
  /** Every page on the page's branch, to move its subtree along and append it in the target language. */
  pages?: readonly PageNode[];
}) {
  const t = useT();
  const update = useUpdatePage(projectId);
  const reorder = useReorderPages(projectId);
  const confirm = useConfirm();
  const isGroup = page.kind === 'GROUP';

  const [slugTouched, setSlugTouched] = useState(false);
  const [section, setSection] = useState<PageSettingsSection>('general');
  // "More options" starts open when the page uses one of them, and opens to show
  // a field that blocks saving.
  const [moreOpen, setMoreOpen] = useState(() => hasMoreOptions(page));
  const [focusField, setFocusField] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per page and per opening, not on every refetch.
  useEffect(() => {
    setMoreOpen(hasMoreOptions(page));
  }, [page.id, open]);
  useEffect(() => {
    if (!focusField || section !== 'general' || !moreOpen) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(focusField)?.focus();
      setFocusField(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField, section, moreOpen]);
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const modeOptions = [
    { value: 'default', label: t('editor.pageSettings.mode.default') },
    { value: 'wide', label: t('editor.pageSettings.mode.wide') },
    { value: 'center', label: t('editor.pageSettings.mode.center') },
  ] as const satisfies ReadonlyArray<{ value: PageMode; label: string }>;

  // The settings are a draft over the saved page (operations/ui-overhaul.md §8.3):
  // opening or selecting another page starts over, a refetch (an autosave, the
  // list) only updates fields the author hasn't touched, and an edit made while a
  // save is in flight survives it.
  const source = useMemo(() => pageSettingsValues(page), [page]);
  const { form, ...draft } = useServerDraftForm<PageSettingsValues>({
    identity: [page.id, open ? 'open' : 'closed'],
    source,
    onSubmit: async (value, outcome) => {
      const invalidIcon = (['categoryIcon', 'icon'] as const).find((key) => value[key] !== source[key] && value[key].trim() && !hasIcon(value[key]));
      if (invalidIcon) {
        // The field may sit on another tab or in the closed "More options": show it.
        setSection('general');
        setMoreOpen(true);
        setFocusField(invalidIcon === 'icon' ? 'page-icon' : 'page-category-icon');
        return 'invalid';
      }
      try {
        const result = await update.mutateAsync({ pageId: page.id, body: pageSettingsBody(value) });
        outcome.succeeded();
        // The dialog moved on (closed, another page) while saving: report nothing to it.
        if (!outcome.isCurrent()) return 'saved';
        toast.success(
          result.addressChanged
            ? // The path is isolated left-to-right so it reads /getting-started, not getting-started/, in Arabic.
              t('editor.pageSettings.addressChanged', {
                path: `⁦/${page.path}⁩`,
                redirects: result.redirectsAdded,
                links: result.linksUpdated,
              })
            : t('editor.pageSettings.saved'),
        );
        if (result.documentsSkipped) toast.warning(t('editor.pageSettings.linksSkipped', { count: result.documentsSkipped }));
        // Close only when nothing newer than what was saved remains. An edit made
        // during the save stays as an unsaved draft, so it is never thrown away.
        if (deepEqual(form.state.values, value)) onOpenChange(false);
        return 'saved';
      } catch (error) {
        outcome.failed();
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'editor.pageSettings.saveError'));
        return 'failed';
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const {
    title,
    slug,
    icon,
    description,
    hidden,
    sidebarTitle,
    tag,
    tags,
    category,
    categoryIcon,
    metaTitle,
    metaDescription,
    ogImage,
    canonicalUrl,
    noindex,
    translationKey,
    mode,
    hideToc,
  } = values;
  const set = <K extends keyof PageSettingsValues>(key: K, value: PageSettingsValues[K]) =>
    (form.setFieldValue as (field: K, value: PageSettingsValues[K]) => void)(key, value);

  const pageId = page.id;
  // The address follows the title again on another page or a fresh open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the draft's identity changes.
  useEffect(() => setSlugTouched(false), [open, pageId]);

  const languageOptions = languages.map((language) => ({ value: language.id, label: language.label }));
  // Moving to another language is its own step (the same move as dragging the
  // page into that language's section), confirmed because the whole subtree goes.
  const moveToLanguage = async (languageId: string) => {
    const target = languages.find((language) => language.id === languageId);
    if (!target || languageId === page.languageId) return;
    const subtree = descendantsOf(page.id, pages);
    const ok = await confirm({
      title: t('editor.pageSettings.moveLanguage.title', { language: target.label }),
      description:
        subtree.length > 0
          ? t('editor.pageSettings.moveLanguage.descriptionWithChildren', { title: page.title, count: subtree.length, language: target.label })
          : t('editor.pageSettings.moveLanguage.description', { title: page.title, language: target.label }),
      confirmLabel: t('editor.pageSettings.moveLanguage.confirm'),
    });
    if (!ok) return;
    const topLevel = pages.filter((other) => other.languageId === languageId && other.branchId === page.branchId && !other.parentId);
    const position = topLevel.length > 0 ? Math.max(...topLevel.map((other) => other.position)) + 1 : 0;
    // What the fields held when the move started: the server's result only
    // replaces a field the author has not edited in the meantime.
    const slugAtStart = slug;
    const slugEditedAtStart = slugTouched;
    const keyAtStart = translationKey;
    reorder.mutate(
      {
        items: [
          { id: page.id, parentId: null, position, languageId },
          ...subtree.map((child) => ({ id: child.id, parentId: child.parentId, position: child.position, languageId })),
        ],
      },
      {
        onSuccess: (list) => {
          const moved = Array.isArray(list) ? list.find((item) => item.id === page.id) : undefined;
          if (moved) {
            // A clash in the target language gives the page a numbered address, and a
            // translation key that language already uses is cleared. Show both, so a
            // later Save can't put the old address or a duplicate key back.
            const current = form.state.values;
            if (!slugEditedAtStart && current.slug === slugAtStart) set('slug', moved.slug);
            if (current.translationKey === keyAtStart) set('translationKey', moved.translationKey ?? '');
          }
          toast.success(t('editor.pageSettings.moveLanguage.done', { language: target.label }));
        },
        onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.pageSettings.moveLanguage.error')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogDescription className="sr-only">{t('editor.pageSettings.desc')}</DialogDescription>
        <div className="flex h-[min(620px,85dvh)] flex-col sm:flex-row">
          {/* Left settings sidebar */}
          <aside className="flex w-full shrink-0 flex-col border-border border-b bg-muted/30 p-2.5 sm:w-48 sm:border-e sm:border-b-0">
            <DialogHeader className="px-2 pt-1.5 pb-3">
              <DialogTitle className="text-start text-base">{isGroup ? t('editor.groupSettings') : t('editor.pageSettings.title')}</DialogTitle>
            </DialogHeader>
            <nav className="flex gap-0.5 overflow-x-auto sm:flex-col">
              {PAGE_SETTINGS_SECTIONS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      'flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-start font-medium text-[13.5px] transition-colors',
                      section === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content + footer */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {section === 'general' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.pageTitle')} hint={t('editor.pageSettings.pageTitleHint')} htmlFor="page-title">
                    <Input
                      id="page-title"
                      value={title}
                      onChange={(e) => {
                        const nextTitle = e.target.value;
                        set('title', nextTitle);
                        if (!slugTouched && PLACEHOLDER_SLUG_RE.test(slug)) {
                          set('slug', slugifyUnicode(nextTitle));
                        }
                      }}
                      placeholder={page.title}
                    />
                  </Field>
                  <Field label={t('editor.pageSettings.slug')} hint={t('editor.pageSettings.slugHint')} htmlFor="page-slug">
                    <Input
                      id="page-slug"
                      dir="auto"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        set('slug', e.target.value);
                      }}
                      placeholder="getting-started"
                    />
                    <p className="text-start text-muted-foreground text-xs">
                      {t('editor.pageSettings.addressPreview')} {/* An address reads left to right even in an Arabic interface. */}
                      <bdi dir="ltr" className="break-all font-mono text-foreground">
                        {pageAddressPreview(page, slug, title)}
                      </bdi>
                    </p>
                    {published && slug.trim() !== page.slug ? (
                      <p className="flex items-start gap-1.5 text-warning text-xs" role="status">
                        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                        {t('editor.pageSettings.slugChangeWarning')}
                      </p>
                    ) : null}
                  </Field>
                  <Field label={t('editor.pageSettings.language')} hint={t('editor.pageSettings.languageHint')} htmlFor="page-language">
                    <Select
                      items={languageOptions}
                      value={page.languageId}
                      onValueChange={(value) => {
                        if (value) void moveToLanguage(value);
                      }}
                      disabled={languageOptions.length < 2 || reorder.isPending}
                    >
                      <SelectTrigger
                        id="page-language"
                        className="w-full"
                        aria-describedby={languageOptions.length < 2 ? 'page-language-reason' : undefined}
                      >
                        <SelectValue>{languageOptions.find((option) => option.value === page.languageId)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {languageOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {languageOptions.length < 2 ? (
                      <p id="page-language-reason" className="text-muted-foreground text-xs">
                        {t('editor.pageSettings.oneLanguage')}
                      </p>
                    ) : null}
                  </Field>
                  <Field label={t('editor.pageSettings.description')} htmlFor="page-desc">
                    <Textarea
                      id="page-desc"
                      value={description}
                      onChange={(e) => set('description', e.target.value)}
                      rows={3}
                      placeholder={t('editor.pageSettings.descriptionPlaceholder')}
                    />
                  </Field>
                  <Toggle
                    label={t('editor.pageSettings.hidden')}
                    hint={t('editor.pageSettings.hiddenHint')}
                    id="page-hidden"
                    checked={hidden}
                    onCheckedChange={(checked) => set('hidden', checked)}
                  />
                  {/* Rarely needed fields stay out of the way until asked for. */}
                  <Collapsible className="border-border border-t pt-3" open={moreOpen} onOpenChange={setMoreOpen}>
                    <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 text-start font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <ChevronRight aria-hidden className="size-4 transition-transform group-data-[panel-open]:rotate-90 rtl:-scale-x-100" />
                      {t('editor.pageSettings.more')}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-4 pt-3">
                      <Field label={t('editor.pageSettings.sidebarTitle')} hint={t('editor.pageSettings.sidebarTitleHint')} htmlFor="page-sidebar">
                        <Input
                          id="page-sidebar"
                          value={sidebarTitle}
                          onChange={(e) => set('sidebarTitle', e.target.value)}
                          placeholder={page.title}
                        />
                      </Field>
                      <Field label={t('editor.pageSettings.tag')} hint={t('editor.pageSettings.tagHint')} htmlFor="page-tag">
                        <Input id="page-tag" value={tag} onChange={(e) => set('tag', e.target.value)} placeholder="New" maxLength={20} />
                      </Field>
                      <Field label={t('editor.pageSettings.tags')} hint={t('editor.pageSettings.tagsHint')} htmlFor="page-tags">
                        <Input id="page-tags" value={tags} onChange={(e) => set('tags', e.target.value)} placeholder="Getting started, Guide" />
                      </Field>
                      <Field label={t('editor.pageSettings.category')} hint={t('editor.pageSettings.categoryHint')} htmlFor="page-category">
                        <Input id="page-category" value={category} onChange={(e) => set('category', e.target.value)} placeholder="Getting started" />
                      </Field>
                      <Field
                        label={t('editor.pageSettings.categoryIcon')}
                        hint={t('editor.pageSettings.categoryIconHint')}
                        htmlFor="page-category-icon"
                      >
                        <IconNameInput
                          id="page-category-icon"
                          value={categoryIcon}
                          onChange={(e) => set('categoryIcon', e.target.value)}
                          placeholder="rocket"
                        />
                      </Field>
                      <Field label={t('editor.pageSettings.icon')} htmlFor="page-icon">
                        <IconNameInput id="page-icon" value={icon} onChange={(e) => set('icon', e.target.value)} placeholder="rocket" />
                      </Field>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ) : null}

              {section === 'seo' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.metaTitle')} hint={t('editor.pageSettings.metaTitleHint')} htmlFor="page-meta-title">
                    <Input id="page-meta-title" value={metaTitle} onChange={(e) => set('metaTitle', e.target.value)} placeholder={page.title} />
                  </Field>
                  <MetaDescriptionField
                    projectId={projectId}
                    pageId={page.id}
                    revision={page.updatedAt}
                    value={metaDescription}
                    onChange={(next) => set('metaDescription', next)}
                    summary={description}
                    // A group has no page of its own on the published site.
                    generated={open && !isGroup}
                    placeholder={page.description ?? undefined}
                  />
                  <Field label={t('editor.pageSettings.ogImage')} hint={t('editor.pageSettings.ogImageHint')} htmlFor="page-og">
                    <Input id="page-og" value={ogImage} onChange={(e) => set('ogImage', e.target.value)} placeholder="https://…/cover.png" />
                  </Field>
                  <Field label={t('editor.pageSettings.canonicalUrl')} hint={t('editor.pageSettings.canonicalUrlHint')} htmlFor="page-canonical">
                    <Input id="page-canonical" value={canonicalUrl} onChange={(e) => set('canonicalUrl', e.target.value)} placeholder="https://…" />
                  </Field>
                  <Toggle
                    label={t('editor.pageSettings.noindex')}
                    hint={t('editor.pageSettings.noindexHint')}
                    id="page-noindex"
                    checked={noindex}
                    onCheckedChange={(checked) => set('noindex', checked)}
                  />
                  <Field
                    label={t('editor.pageSettings.translationKey')}
                    hint={t('editor.pageSettings.translationKeyHint')}
                    htmlFor="page-translation-key"
                  >
                    <Input
                      id="page-translation-key"
                      value={translationKey}
                      onChange={(e) => set('translationKey', e.target.value)}
                      placeholder="getting-started"
                    />
                  </Field>
                </div>
              ) : null}

              {section === 'behaviour' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.mode')} hint={t('editor.pageSettings.modeHint')} htmlFor="page-mode">
                    <Select items={modeOptions} value={mode} onValueChange={(v) => set('mode', v ?? 'default')}>
                      <SelectTrigger id="page-mode" className="w-full">
                        <SelectValue>{modeOptions.find((option) => option.value === mode)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {modeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Toggle
                    label={t('editor.pageSettings.hideToc')}
                    hint={t('editor.pageSettings.hideTocHint')}
                    id="page-hidetoc"
                    checked={hideToc}
                    onCheckedChange={(checked) => set('hideToc', checked)}
                    disabled={mode !== 'default'}
                  />
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-border border-t px-6 py-3">
              <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
              <Button type="button" onClick={() => void draft.submit()} loading={draft.isSaving} loadingText={t('common.saving')}>
                {t('editor.pageSettings.save')}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Every page nested under `id`, at any depth. */
function descendantsOf(id: string, pages: readonly PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  const parents = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const page of pages) {
      if (page.parentId && parents.has(page.parentId) && !parents.has(page.id)) {
        parents.add(page.id);
        out.push(page);
        added = true;
      }
    }
  }
  return out;
}

/** Open "More options" straight away when the page already uses one of them. */
function hasMoreOptions(page: PageNode): boolean {
  const config = page.config;
  return Boolean(
    page.icon ||
      config?.sidebarTitle ||
      config?.tag ||
      config?.tags?.length ||
      config?.category ||
      config?.categoryIcon ||
      config?.categoryOrder !== undefined,
  );
}

/** The page's address on the published site, as it will be after saving. */
function pageAddressPreview(page: PageNode, slug: string, title: string): string {
  const segment = slugifyUnicode(slug.trim() || title.trim()) || page.slug;
  const parentPath = page.path.endsWith(page.slug) ? page.path.slice(0, page.path.length - page.slug.length).replace(/\/$/, '') : '';
  return `/${joinPath(parentPath || null, segment)}`;
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

function IconNameInput(props: React.ComponentProps<typeof Input> & { value: string; id: string }) {
  const t = useT();
  const invalid = props.value.trim() !== '' && !hasIcon(props.value);
  return (
    <>
      <div className="flex items-center gap-2">
        <Input {...props} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${props.id}-error` : undefined} />
        <PageIcon name={props.value} className="size-5 shrink-0" />
      </div>
      {invalid ? (
        <p id={`${props.id}-error`} role="status" className="text-destructive text-xs">
          {t('editor.pageSettings.invalidIcon')}
        </p>
      ) : null}
    </>
  );
}

/** Search engines show about this many characters of a description. */
const SEARCH_SNIPPET_LENGTH = 155;

/** The SEO description. With neither it nor the page summary written, the
 *  published site generates one from the page's text: show that text and offer
 *  to start from it. */
function MetaDescriptionField({
  projectId,
  pageId,
  revision,
  value,
  onChange,
  summary,
  generated,
  placeholder,
}: {
  projectId: string;
  pageId: string;
  /** The saved page revision the dialog shows (`updatedAt`). */
  revision: string;
  value: string;
  onChange: (value: string) => void;
  /** The page summary as currently typed; search engines use it when there is no SEO description. */
  summary: string;
  /** Whether the page gets a generated description at all. */
  generated: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const input = useRef<HTMLTextAreaElement>(null);
  const automatic = generated && value.trim() === '' && summary.trim() === '';
  const search = usePageSearchDescription(projectId, pageId, { enabled: automatic });
  // Only an answer computed from the saved page as it is now (or later) is
  // shown: a cached one for an older body counts as loading until the refetch
  // brings the new one. It can be adopted only once no refetch is running.
  const answer = search.data;
  const current = answer && !search.isError && answer.revision >= revision ? answer : undefined;
  const adoptable = current && !search.isFetching ? current : undefined;
  const text = current?.description ?? '';
  const writeOwn = () => {
    if (!adoptable) return;
    onChange(adoptable.description);
    input.current?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label={t('editor.pageSettings.metaDescription')} hint={t('editor.pageSettings.metaDescriptionHint')} htmlFor="page-meta-desc">
        <Textarea id="page-meta-desc" ref={input} value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} />
      </Field>
      {automatic ? (
        <Callout
          data-testid="search-description-preview"
          icon={<SearchCheck />}
          // Without the generated text (it failed to load) only the prompt is left.
          title={search.isError ? undefined : t('editor.pageSettings.searchPreview.label')}
          action={
            <Button type="button" size="sm" variant="outline" onClick={writeOwn} disabled={!adoptable}>
              {t('editor.pageSettings.searchPreview.writeOwn')}
            </Button>
          }
        >
          {search.isError ? null : !current ? (
            <div className="mb-2 flex flex-col gap-1.5" aria-hidden data-slot="search-description-loading">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ) : text ? (
            <p dir="auto" className="text-start text-muted-foreground" data-slot="search-description">
              {truncateText(text, SEARCH_SNIPPET_LENGTH)}
            </p>
          ) : (
            <p className="text-start">{t('editor.pageSettings.searchPreview.empty')}</p>
          )}
          <p className="text-start text-foreground">{t('editor.pageSettings.searchPreview.prompt')}</p>
        </Callout>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
