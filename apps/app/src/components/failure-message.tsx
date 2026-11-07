import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { ProjectAdminStatus } from '@/hooks/use-project-admin-status';

/** Stored job errors have no stable codes yet. Match known reasons and keep
 * unknown provider wording out of the main message. */
export function failureMessageKey(error: string, context: 'publish' | 'export' | 'git', role: ProjectAdminStatus = 'pending'): MessageKey {
  if (context === 'export' && /no published revision/i.test(error)) return 'failures.unpublished';
  if (context === 'export' && /exceed.*(?:limit|bytes)|too large/i.test(error)) return 'failures.tooLarge';
  if (context === 'publish' && /redirect|route collision/i.test(error)) {
    if (role === 'admin') return 'failures.redirectsAdmin';
    if (role === 'not-admin') return 'failures.redirectsEditor';
    return 'failures.redirects';
  }
  if (context === 'git' && /conflict|non.fast.forward/i.test(error)) return 'failures.conflict';
  if (/unauthorized|forbidden|permission denied|bad credentials|authentication|token.*expired/i.test(error)) return 'failures.access';
  if (/timeout|timed out|fetch failed|ECONN|ENOTFOUND|network/i.test(error)) return 'failures.connection';
  if (/chromium|executable.*(?:missing|not found)|not configured|not enabled/i.test(error)) return 'failures.unavailable';
  return `failures.${context}`;
}

export function FailureDetails({ detail }: { detail: string }) {
  const t = useT();
  return (
    <details className="mt-1 min-w-0 text-muted-foreground text-xs">
      <summary className="min-h-11 cursor-pointer content-center">{t('failures.details')}</summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 [overflow-wrap:anywhere]" dir="auto">
        {detail}
      </pre>
    </details>
  );
}

export function FailureMessage({ error, context }: { error: string; context: 'publish' | 'export' | 'git' }) {
  const t = useT();
  return (
    <div className="mt-2 min-w-0 text-xs">
      <p className="text-destructive">{t(failureMessageKey(error, context))}</p>
      <FailureDetails detail={error} />
    </div>
  );
}
