import { Button } from '@nibleaf/design-system/components/ui/button';
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
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { slugify } from '@nibleaf/shared/utils';
import { CirclePlus, type LucideIcon, PanelsTopLeft, SearchCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { PageConfig, PageNode } from '@/hooks/api';
import { useUpdatePage } from '@/hooks/api';

type PageMode = 'default' | 'wide' | 'center';
type PageSettingsSection = 'general' | 'seo' | 'behaviour';

const PAGE_SETTINGS_SECTIONS = [
  { id: 'general', labelKey: 'editor.pageSettings.tab.general', icon: CirclePlus },
  { id: 'seo', labelKey: 'editor.pageSettings.tab.seo', icon: SearchCheck },
  { id: 'behaviour', labelKey: 'editor.pageSettings.tab.behaviour', icon: PanelsTopLeft },
] as const satisfies ReadonlyArray<{ id: PageSettingsSection; labelKey: MessageKey; icon: LucideIcon }>;

const PLACEHOLDER_SLUG_RE = /^(?:untitled|new-group)(?:-\d+)?$/;

/** Per-page settings — General (nav metadata), SEO override, and Behaviour
 *  (layout). The SEO + behaviour fields persist to `page.config`, layered over
 *  the language and site defaults on the published site. */
export function PageSettingsDialog({
  projectId,
  page,
  open,
  onOpenChange,
}: {
  projectId: string;
  page: PageNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const update = useUpdatePage(projectId);

  // General
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [description, setDescription] = useState(page.description ?? '');
  const [hidden, setHidden] = useState(page.hidden);
  const [sidebarTitle, setSidebarTitle] = useState(page.config?.sidebarTitle ?? '');
  const [tag, setTag] = useState(page.config?.tag ?? '');
  const [tags, setTags] = useState((page.config?.tags ?? []).join(', '));
  const [category, setCategory] = useState(page.config?.category ?? '');
  const [categoryIcon, setCategoryIcon] = useState(page.config?.categoryIcon ?? '');
  const [categoryOrder, setCategoryOrder] = useState(page.config?.categoryOrder?.toString() ?? '');
  // SEO
  const [metaTitle, setMetaTitle] = useState(page.config?.seo?.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(page.config?.seo?.metaDescription ?? '');
  const [ogImage, setOgImage] = useState(page.config?.seo?.ogImage ?? '');
  const [canonicalUrl, setCanonicalUrl] = useState(page.config?.seo?.canonicalUrl ?? '');
  const [noindex, setNoindex] = useState(page.config?.seo?.noindex ?? false);
  const [translationKey, setTranslationKey] = useState(page.translationKey ?? '');
  // Behaviour
  const [mode, setMode] = useState<PageMode>(page.config?.mode ?? 'default');
  const [hideToc, setHideToc] = useState(page.config?.hideToc ?? false);
  const [section, setSection] = useState<PageSettingsSection>('general');
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const modeOptions = [
    { value: 'default', label: t('editor.pageSettings.mode.default') },
    { value: 'wide', label: t('editor.pageSettings.mode.wide') },
    { value: 'center', label: t('editor.pageSettings.mode.center') },
  ] as const satisfies ReadonlyArray<{ value: PageMode; label: string }>;

  // Re-seed the form from the page each time the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(page.title);
    setSlug(page.slug);
    setSlugTouched(false);
    setIcon(page.icon ?? '');
    setDescription(page.description ?? '');
    setHidden(page.hidden);
    setSidebarTitle(page.config?.sidebarTitle ?? '');
    setTag(page.config?.tag ?? '');
    setTags((page.config?.tags ?? []).join(', '));
    setCategory(page.config?.category ?? '');
    setCategoryIcon(page.config?.categoryIcon ?? '');
    setCategoryOrder(page.config?.categoryOrder?.toString() ?? '');
    setMetaTitle(page.config?.seo?.metaTitle ?? '');
    setMetaDescription(page.config?.seo?.metaDescription ?? '');
    setOgImage(page.config?.seo?.ogImage ?? '');
    setCanonicalUrl(page.config?.seo?.canonicalUrl ?? '');
    setNoindex(page.config?.seo?.noindex ?? false);
    setTranslationKey(page.translationKey ?? '');
    setMode(page.config?.mode ?? 'default');
    setHideToc(page.config?.hideToc ?? false);
  }, [open, page]);

  const save = () => {
    // A complete config object so the server merge replaces every managed key
    // (empty strings/false read as "no override" via the SEO fallback chain, and
    // blanking a field clears it). When nothing is overridden, send null so the
    // page's config stays null instead of bloating with an empty object.
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
    update.mutate(
      {
        pageId: page.id,
        body: {
          title: title.trim(),
          slug: slug.trim() || title.trim(),
          icon: icon.trim() || null,
          description: description.trim() || null,
          hidden,
          translationKey: translationKey.trim() || null,
          config: hasOverride ? config : null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('editor.pageSettings.saved'));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.pageSettings.saveError')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogDescription className="sr-only">{t('editor.pageSettings.desc')}</DialogDescription>
        <div className="flex h-[min(560px,80vh)]">
          {/* Left settings sidebar */}
          <aside className="flex w-48 shrink-0 flex-col border-border border-e bg-muted/30 p-2.5">
            <DialogHeader className="px-2 pt-1.5 pb-3">
              <DialogTitle className="text-start text-base">{t('editor.pageSettings.title')}</DialogTitle>
            </DialogHeader>
            <nav className="flex flex-col gap-0.5">
              {PAGE_SETTINGS_SECTIONS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-start font-medium text-[13.5px] transition-colors',
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
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {section === 'general' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.pageTitle')} hint={t('editor.pageSettings.pageTitleHint')} htmlFor="page-title">
                    <Input
                      id="page-title"
                      value={title}
                      onChange={(e) => {
                        const nextTitle = e.target.value;
                        setTitle(nextTitle);
                        if (!slugTouched && PLACEHOLDER_SLUG_RE.test(slug)) {
                          setSlug(slugify(nextTitle));
                        }
                      }}
                      placeholder={page.title}
                    />
                  </Field>
                  <Field label={t('editor.pageSettings.slug')} hint={t('editor.pageSettings.slugHint')} htmlFor="page-slug">
                    <Input
                      id="page-slug"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value);
                      }}
                      placeholder="getting-started"
                    />
                  </Field>
                  <Field label={t('editor.pageSettings.sidebarTitle')} hint={t('editor.pageSettings.sidebarTitleHint')} htmlFor="page-sidebar">
                    <Input id="page-sidebar" value={sidebarTitle} onChange={(e) => setSidebarTitle(e.target.value)} placeholder={page.title} />
                  </Field>
                  <Field label={t('editor.pageSettings.tag')} hint={t('editor.pageSettings.tagHint')} htmlFor="page-tag">
                    <Input id="page-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="New" maxLength={20} />
                  </Field>
                  <Field label={t('editor.pageSettings.tags')} hint={t('editor.pageSettings.tagsHint')} htmlFor="page-tags">
                    <Input id="page-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Getting started, Guide" />
                  </Field>
                  <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                    <Field label={t('editor.pageSettings.category')} hint={t('editor.pageSettings.categoryHint')} htmlFor="page-category">
                      <Input id="page-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Getting started" />
                    </Field>
                    <Field label={t('editor.pageSettings.categoryOrder')} htmlFor="page-category-order">
                      <Input
                        id="page-category-order"
                        type="number"
                        min={0}
                        max={999}
                        value={categoryOrder}
                        onChange={(e) => setCategoryOrder(e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                  </div>
                  <Field label={t('editor.pageSettings.categoryIcon')} hint={t('editor.pageSettings.categoryIconHint')} htmlFor="page-category-icon">
                    <Input id="page-category-icon" value={categoryIcon} onChange={(e) => setCategoryIcon(e.target.value)} placeholder="rocket" />
                  </Field>
                  <Field label={t('editor.pageSettings.icon')} htmlFor="page-icon">
                    <Input id="page-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="rocket" />
                  </Field>
                  <Field label={t('editor.pageSettings.description')} htmlFor="page-desc">
                    <Textarea
                      id="page-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      placeholder={t('editor.pageSettings.descriptionPlaceholder')}
                    />
                  </Field>
                  <Toggle
                    label={t('editor.pageSettings.hidden')}
                    hint={t('editor.pageSettings.hiddenHint')}
                    id="page-hidden"
                    checked={hidden}
                    onCheckedChange={setHidden}
                  />
                </div>
              ) : null}

              {section === 'seo' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.metaTitle')} hint={t('editor.pageSettings.metaTitleHint')} htmlFor="page-meta-title">
                    <Input id="page-meta-title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder={page.title} />
                  </Field>
                  <Field
                    label={t('editor.pageSettings.metaDescription')}
                    hint={t('editor.pageSettings.metaDescriptionHint')}
                    htmlFor="page-meta-desc"
                  >
                    <Textarea
                      id="page-meta-desc"
                      value={metaDescription}
                      onChange={(e) => setMetaDescription(e.target.value)}
                      rows={2}
                      placeholder={page.description ?? undefined}
                    />
                  </Field>
                  <Field label={t('editor.pageSettings.ogImage')} hint={t('editor.pageSettings.ogImageHint')} htmlFor="page-og">
                    <Input id="page-og" value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="https://…/cover.png" />
                  </Field>
                  <Field label={t('editor.pageSettings.canonicalUrl')} hint={t('editor.pageSettings.canonicalUrlHint')} htmlFor="page-canonical">
                    <Input id="page-canonical" value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} placeholder="https://…" />
                  </Field>
                  <Toggle
                    label={t('editor.pageSettings.noindex')}
                    hint={t('editor.pageSettings.noindexHint')}
                    id="page-noindex"
                    checked={noindex}
                    onCheckedChange={setNoindex}
                  />
                  <Field
                    label={t('editor.pageSettings.translationKey')}
                    hint={t('editor.pageSettings.translationKeyHint')}
                    htmlFor="page-translation-key"
                  >
                    <Input
                      id="page-translation-key"
                      value={translationKey}
                      onChange={(e) => setTranslationKey(e.target.value)}
                      placeholder="getting-started"
                    />
                  </Field>
                </div>
              ) : null}

              {section === 'behaviour' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.pageSettings.mode')} hint={t('editor.pageSettings.modeHint')} htmlFor="page-mode">
                    <Select items={modeOptions} value={mode} onValueChange={(v) => setMode(v ?? 'default')}>
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
                    onCheckedChange={setHideToc}
                    disabled={mode !== 'default'}
                  />
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-border border-t px-6 py-3">
              <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
              <Button type="button" onClick={save} disabled={update.isPending}>
                {update.isPending ? t('common.saving') : t('editor.pageSettings.save')}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
