import { Button } from '@nibleaf/design-system/components/ui/button';
import { Download, FileArchive } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { SectionHeader } from './shared';

/**
 * Content exports — no lock-in: every plan (the whole platform is a free beta)
 * can download the full docs as a Markdown zip at any time. The link hits
 * GET /api/app/projects/:projectId/export (project-member auth via the
 * same-origin session cookie; Content-Disposition: attachment).
 */
export function ExportsSection({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <div>
      <SectionHeader icon="⇩" title={t('settings.exports.title')} description={t('settings.exportsSection.description')} />
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileArchive className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-snug">
          <div className="font-medium text-sm">{t('settings.exportsSection.markdown.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('settings.exportsSection.markdown.description')}</p>
        </div>
        <Button
          nativeButton={false}
          render={
            // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
            <a aria-label={t('settings.exportsSection.download')} href={`/api/app/projects/${projectId}/export`} download />
          }
          variant="outline"
        >
          <Download className="size-3.5" /> {t('settings.exportsSection.download')}
        </Button>
      </div>
    </div>
  );
}
