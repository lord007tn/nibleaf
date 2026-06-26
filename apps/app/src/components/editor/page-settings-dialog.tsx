import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Page, PageConfig } from '@/hooks/api';
import { useUpdatePage } from '@/hooks/api';
import { useT } from '@/lib/i18n';

type PageMode = 'default' | 'wide' | 'center';

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
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const update = useUpdatePage(projectId);

  // General
  const [slug, setSlug] = useState(page.slug);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [description, setDescription] = useState(page.description ?? '');
  const [hidden, setHidden] = useState(page.hidden);
  const [sidebarTitle, setSidebarTitle] = useState(page.config?.sidebarTitle ?? '');
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

  // Re-seed the form from the page each time the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setSlug(page.slug);
    setIcon(page.icon ?? '');
    setDescription(page.description ?? '');
    setHidden(page.hidden);
    setSidebarTitle(page.config?.sidebarTitle ?? '');
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
    const config: PageConfig = {
      sidebarTitle: sidebarTitle.trim(),
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
      mode !== 'default' ||
      hideToc ||
      [metaTitle, metaDescription, ogImage, canonicalUrl].some((v) => v.trim() !== '') ||
      noindex;
    update.mutate(
      {
        pageId: page.id,
        body: {
          slug: slug.trim(),
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editor.pageSettings.title')}</DialogTitle>
          <DialogDescription>{t('editor.pageSettings.desc')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-1">
          <TabsList>
            <TabsTrigger value="general">{t('editor.pageSettings.tab.general')}</TabsTrigger>
            <TabsTrigger value="seo">{t('editor.pageSettings.tab.seo')}</TabsTrigger>
            <TabsTrigger value="behaviour">{t('editor.pageSettings.tab.behaviour')}</TabsTrigger>
          </TabsList>

          {/* General */}
          <TabsContent value="general" className="mt-4 flex flex-col gap-4">
            <Field label={t('editor.pageSettings.slug')} hint={t('editor.pageSettings.slugHint')} htmlFor="page-slug">
              <Input id="page-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="getting-started" />
            </Field>
            <Field label={t('editor.pageSettings.sidebarTitle')} hint={t('editor.pageSettings.sidebarTitleHint')} htmlFor="page-sidebar">
              <Input id="page-sidebar" value={sidebarTitle} onChange={(e) => setSidebarTitle(e.target.value)} placeholder={page.title} />
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
          </TabsContent>

          {/* SEO */}
          <TabsContent value="seo" className="mt-4 flex flex-col gap-4">
            <Field label={t('editor.pageSettings.metaTitle')} hint={t('editor.pageSettings.metaTitleHint')} htmlFor="page-meta-title">
              <Input id="page-meta-title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder={page.title} />
            </Field>
            <Field label={t('editor.pageSettings.metaDescription')} hint={t('editor.pageSettings.metaDescriptionHint')} htmlFor="page-meta-desc">
              <Textarea id="page-meta-desc" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={2} />
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
            <Field label={t('editor.pageSettings.translationKey')} hint={t('editor.pageSettings.translationKeyHint')} htmlFor="page-translation-key">
              <Input
                id="page-translation-key"
                value={translationKey}
                onChange={(e) => setTranslationKey(e.target.value)}
                placeholder="getting-started"
              />
            </Field>
          </TabsContent>

          {/* Behaviour */}
          <TabsContent value="behaviour" className="mt-4 flex flex-col gap-4">
            <Field label={t('editor.pageSettings.mode')} hint={t('editor.pageSettings.modeHint')} htmlFor="page-mode">
              <Select value={mode} onValueChange={(v) => setMode((v as PageMode) ?? 'default')}>
                <SelectTrigger id="page-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('editor.pageSettings.mode.default')}</SelectItem>
                  <SelectItem value="wide">{t('editor.pageSettings.mode.wide')}</SelectItem>
                  <SelectItem value="center">{t('editor.pageSettings.mode.center')}</SelectItem>
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
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('editor.pageSettings.save')}
          </Button>
        </DialogFooter>
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
