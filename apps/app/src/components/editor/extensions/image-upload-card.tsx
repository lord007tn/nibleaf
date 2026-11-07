import { Button } from '@nibleaf/design-system/components/ui/button';
import { translateFn as t } from '@nibleaf/i18n';

export interface ImageUploadCardProps {
  filename: string;
  failed: boolean;
  retrying: boolean;
  progress: number | null;
  finishing: boolean;
  timedOut: boolean;
  editable: boolean;
  retry: () => void;
  remove: () => void;
}

export function ImageUploadCard({ filename, failed, retrying, progress, finishing, timedOut, editable, retry, remove }: ImageUploadCardProps) {
  return (
    <span contentEditable={false} className="my-2 inline-flex w-80 max-w-full flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-sm">
      <span className="break-words font-medium" dir="auto">
        {filename}
      </span>
      <span role="status" aria-live="polite">
        {t(
          failed
            ? timedOut
              ? 'editor.image.timeout'
              : 'editor.image.uploadFailed'
            : finishing
              ? 'editor.image.finishing'
              : 'editor.image.uploading',
        )}
      </span>
      {!failed ? (
        <progress
          className="h-2 w-full motion-reduce:animate-none"
          aria-label={`${t('editor.image.uploading')} ${filename}`}
          max={100}
          value={progress ?? undefined}
        />
      ) : null}
      <span className="flex flex-wrap gap-2">
        {failed || retrying ? (
          <Button disabled={!editable} loading={retrying} variant="outline" className="min-h-11" onClick={retry}>
            {t('editor.image.retry')}
          </Button>
        ) : null}
        <Button disabled={!editable} aria-label={t('editor.image.removeFile', { filename })} variant="ghost" className="min-h-11" onClick={remove}>
          {t('editor.image.remove')}
        </Button>
      </span>
    </span>
  );
}
