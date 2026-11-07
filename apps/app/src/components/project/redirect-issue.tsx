import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { RedirectIssueCode, RedirectValidationIssue } from '@nibleaf/shared/redirects';

const issueKeys: Record<RedirectIssueCode, MessageKey> = {
  'malformed-source': 'publish.redirectIssue.malformedSource',
  'malformed-destination': 'publish.redirectIssue.malformedDestination',
  'duplicate-source': 'publish.redirectIssue.duplicateSource',
  'self-redirect': 'publish.redirectIssue.selfRedirect',
  cycle: 'publish.redirectIssue.cycle',
  'chain-too-long': 'publish.redirectIssue.chainTooLong',
  'too-many-rules': 'publish.redirectIssue.tooManyRules',
  'source-collision': 'publish.redirectIssue.sourceCollision',
  'destination-not-found': 'publish.redirectIssue.destinationNotFound',
  'invalid-locale': 'publish.redirectIssue.invalidLocale',
  'route-collision': 'publish.redirectIssue.routeCollision',
};

export function RedirectIssue({ issue }: { issue: RedirectValidationIssue }) {
  const t = useT();
  return (
    <li>
      <p>{t(issueKeys[issue.code] ?? 'publish.redirectIssue.unknown')}</p>
      <p className="mt-1 break-words font-mono text-muted-foreground [overflow-wrap:anywhere]">
        <bdi dir="ltr">{issue.sequence.join(' → ')}</bdi>
      </p>
    </li>
  );
}
