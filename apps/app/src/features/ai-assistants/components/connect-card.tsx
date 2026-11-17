import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { useLocale } from '@nibleaf/i18n/react';
import { CircleCheck, KeyRound, LoaderCircle } from 'lucide-react';
import { Fragment } from 'react';
import { type AssistantClient, CLIENT_NAMES, type ConnectStep, clientChoices, connectSteps } from '../model/clients';
import { canRestart, type WatchState } from '../model/connect-watch';

/**
 * Connect an assistant: pick the app, then follow two or three numbered steps
 * with the address on the step where it is pasted. Copying or installing
 * starts watching for the app (`onStarted`); `watch` says how far it got.
 */
export function ConnectCard({
  client,
  onClientChange,
  endpoint,
  signIn,
  siteName,
  watch,
  onStarted,
  onRestart,
  onCreateKey,
}: {
  client: AssistantClient;
  onClientChange: (client: AssistantClient) => void;
  endpoint: string;
  signIn: boolean;
  siteName: string;
  watch: WatchState | null;
  onStarted: () => void;
  onRestart: () => void;
  onCreateKey: () => void;
}) {
  const { t } = useLocale();
  const choices = clientChoices(signIn);
  const blocked = choices.find((choice) => choice.client === client)?.disabledReason;
  const steps = connectSteps(client, { endpoint, signIn });
  const app = CLIENT_NAMES[client];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-medium text-sm" id="assistant-app-label">
          {t('settings.aiAssistants.chooseApp')}
        </p>
        <SegmentedControl aria-labelledby="assistant-app-label" className="self-start" role="group">
          {choices.map((choice) => (
            <SegmentedControlItem active={client === choice.client} key={choice.client} onClick={() => onClientChange(choice.client)}>
              <bdi>{CLIENT_NAMES[choice.client]}</bdi>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {blocked ? (
        <Callout tone="neutral">{t('settings.aiAssistants.needsHttps', { app })}</Callout>
      ) : (
        <ol className="flex min-w-0 flex-col gap-4">
          {steps.map((step, index) => (
            <li className="flex min-w-0 gap-3" key={step.text}>
              <span
                aria-hidden
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary text-xs tabular-nums"
              >
                {index + 1}
              </span>
              <StepBody app={app} onCreateKey={onCreateKey} onStarted={onStarted} siteName={siteName} step={step} />
            </li>
          ))}
        </ol>
      )}

      {watch ? <WatchStatus app={app} onRestart={onRestart} state={watch} /> : null}
    </div>
  );
}

function StepBody({
  step,
  app,
  siteName,
  onStarted,
  onCreateKey,
}: {
  step: ConnectStep;
  app: string;
  siteName: string;
  onStarted: () => void;
  onCreateKey: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
      <p>{t(`settings.aiAssistants.step.${step.text}`, { app, site: siteName })}</p>
      {step.menu ? (
        // A menu path is its own left-to-right line: inside Arabic text the
        // bidi algorithm would reverse the English names and their arrows.
        <p className="flex min-w-0 flex-wrap items-center gap-1 self-start font-medium" dir="ltr">
          {step.menu.map((item, index) => (
            <Fragment key={item}>
              {index > 0 ? (
                <span aria-hidden className="text-muted-foreground">
                  ›
                </span>
              ) : null}
              <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs">{item}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
      {step.copy ? <CopyBlock copy={step.copy} onCopied={onStarted} /> : null}
      {step.install ? (
        <div>
          <Button nativeButton={false} onClick={onStarted} render={<a href={step.install.href} />} variant="outline">
            {t(step.install.client === 'cursor' ? 'settings.apiKeys.installCursor' : 'settings.apiKeys.installVscode')}
          </Button>
        </div>
      ) : null}
      {step.createKey ? (
        <div>
          <Button onClick={onCreateKey} type="button">
            <KeyRound aria-hidden />
            {t('settings.aiAssistants.createKey')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CopyBlock({ copy, onCopied }: { copy: NonNullable<ConnectStep['copy']>; onCopied: () => void }) {
  const { t } = useLocale();
  const label =
    copy.kind === 'url'
      ? t('settings.aiAssistants.copyAddress')
      : copy.kind === 'command'
        ? t('settings.aiAssistants.copyCommand')
        : t('settings.aiAssistants.copyConfig');
  if (copy.kind === 'url')
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 py-1 ps-3 pe-1">
        <code className="min-w-0 flex-1 break-all text-sm" dir="ltr">
          {copy.value}
        </code>
        <CopyButton
          aria-label={label}
          copiedLabel={t('settings.aiAssistants.copied')}
          failedLabel={t('settings.apiKeys.copyFailed')}
          label={label}
          onClick={onCopied}
          size="sm"
          value={copy.value}
          variant="outline"
        >
          {t('settings.apiKeys.copy')}
        </CopyButton>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {copy.file ? (
        <code className="self-start text-muted-foreground text-xs" dir="ltr">
          {copy.file}
        </code>
      ) : null}
      <div className="relative min-w-0">
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 pe-12 text-xs" dir="ltr">
          <code>{copy.value}</code>
        </pre>
        <CopyButton
          className="absolute end-1.5 top-1.5"
          copiedLabel={t('settings.aiAssistants.copied')}
          failedLabel={t('settings.apiKeys.copyFailed')}
          label={label}
          onClick={onCopied}
          size="icon-sm"
          value={copy.value}
        />
      </div>
    </div>
  );
}

function WatchStatus({ state, app, onRestart }: { state: WatchState; app: string; onRestart: () => void }) {
  const { t } = useLocale();
  const working = state.kind === 'working';
  const pending = state.kind === 'waiting' || state.kind === 'authorized';
  const attention = state.kind === 'unexpected' || state.kind === 'stalled';
  const message =
    state.kind === 'waiting'
      ? t('settings.aiAssistants.watch.waiting', { app })
      : state.kind === 'authorized'
        ? t('settings.aiAssistants.watch.authorized', { name: state.app.name })
        : state.kind === 'working'
          ? t('settings.aiAssistants.watch.working', { name: state.app.name })
          : state.kind === 'stalled'
            ? t('settings.aiAssistants.watch.stalled', { name: state.app.name, app })
            : state.kind === 'unexpected'
              ? t('settings.aiAssistants.watch.unexpected', { name: state.app.name, app })
              : t('settings.aiAssistants.watch.timedOut', { app });
  return (
    <div
      className="flex flex-wrap items-start gap-x-2 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm data-[tone=attention]:border-warning/40 data-[tone=attention]:bg-warning/5 data-[tone=success]:border-success/30 data-[tone=success]:bg-success/5"
      data-tone={working ? 'success' : attention ? 'attention' : undefined}
    >
      {working ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : null}
      {pending ? <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : null}
      <p className="min-w-0 flex-1" role="status">
        {message}
      </p>
      {canRestart(state) ? (
        <Button onClick={onRestart} size="sm" type="button" variant="outline">
          {t('settings.aiAssistants.watch.again')}
        </Button>
      ) : null}
    </div>
  );
}
