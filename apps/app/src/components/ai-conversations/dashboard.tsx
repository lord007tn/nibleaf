import { Alert, AlertDescription } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { RangeTabs } from '@/components/analytics/range-tabs';
import { useAiContentGaps, useAiConversationSummary, useAiConversations } from '@/hooks/api/ai-conversations';
import { ConversationList } from './conversation-list';
import { ConversationDetail } from './detail';
import { ContentGaps } from './gaps';
import { Overview } from './overview';
import { type AiDashboardSearch, conversationFilters } from './search';
export function AiDashboard({
  projectId,
  search,
  onChange,
}: {
  projectId: string;
  search: AiDashboardSearch;
  onChange: (patch: Partial<AiDashboardSearch>, replace?: boolean) => void;
}) {
  const t = useT();
  const [text, setText] = useState(search.q ?? '');
  const [previousQuery, setPreviousQuery] = useState(search.q);
  if (previousQuery !== search.q) {
    setPreviousQuery(search.q);
    setText(search.q ?? '');
  }
  useEffect(() => {
    if (text.trim() === (search.q ?? '')) return;
    const timer = setTimeout(() => onChange({ q: text.trim() || undefined }, true), 350);
    return () => clearTimeout(timer);
  }, [text, search.q, onChange]);
  const summary = useAiConversationSummary(projectId, search.range, search.language);
  const languageSummary = useAiConversationSummary(projectId, search.range);
  const list = useAiConversations(projectId, conversationFilters(search), search.tab === 'conversations');
  const gaps = useAiContentGaps(projectId, search.range, search.language, search.tab === 'gaps');
  const active = search.tab === 'overview' ? summary : search.tab === 'gaps' ? gaps : list;
  const state = search.tab === 'conversations' ? list.data?.pages[0] : search.tab === 'gaps' ? gaps.data : summary.data;
  const disabled = state?.availability === 'disabled';
  const unavailable = active.isError || state?.availability === 'unavailable';
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const empty =
    search.tab === 'overview' ? summary.data?.totals.questions === 0 : search.tab === 'gaps' ? gaps.data?.items.length === 0 : items.length === 0;
  return (
    <div className="w-full space-y-6 px-4 py-8 sm:px-6 xl:px-10">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('dashboard.ai.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.ai.subtitle')}</p>
        </div>
        <RangeTabs
          ranges={['7d', '30d', '90d']}
          value={search.range}
          onValueChange={(range) => {
            if (range !== '24h') onChange({ range });
          }}
        />
      </div>
      <Tabs value={search.tab} onValueChange={(tab) => onChange({ tab: tab as AiDashboardSearch['tab'] })}>
        <TabsList className="max-w-full">
          {(['overview', 'conversations', 'gaps'] as const).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`dashboard.ai.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={search.language ?? ''} onValueChange={(language) => onChange({ language: language || undefined })}>
          <SelectTrigger aria-label={t('dashboard.ai.language')} className="w-44">
            <SelectValue>{search.language ?? t('dashboard.ai.allLanguages')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('dashboard.ai.allLanguages')}</SelectItem>
            {[
              ...new Set([...(languageSummary.data?.languages.map((item) => item.language) ?? []), ...(search.language ? [search.language] : [])]),
            ].map((language) => (
              <SelectItem value={language} key={language}>
                {language}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {search.tab === 'conversations' && (
          <>
            <Select
              value={search.rating ?? ''}
              onValueChange={(rating) => onChange({ rating: rating ? (rating as AiDashboardSearch['rating']) : undefined })}
            >
              <SelectTrigger aria-label={t('dashboard.ai.rating')} className="w-44">
                <SelectValue>{search.rating ? t(`dashboard.ai.${search.rating}`) : t('dashboard.ai.allRatings')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('dashboard.ai.allRatings')}</SelectItem>
                {(['up', 'down', 'unrated'] as const).map((rating) => (
                  <SelectItem value={rating} key={rating}>
                    {t(`dashboard.ai.${rating}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label htmlFor="ai-unanswered" className="flex items-center gap-2 text-sm">
              <Switch
                id="ai-unanswered"
                checked={search.status === 'no_answer'}
                onCheckedChange={(checked) => onChange({ status: checked ? 'no_answer' : undefined })}
              />
              {t('dashboard.ai.unanswered')}
            </label>
            <Input
              className="w-full sm:w-64"
              aria-label={t('dashboard.ai.search')}
              placeholder={t('dashboard.ai.search')}
              maxLength={120}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </>
        )}
      </div>
      {state?.captureEnabled === false && (
        <Alert variant="info">
          <AlertDescription>
            {t('dashboard.ai.captureOff')}{' '}
            <Link className="underline" to="/app/projects/$projectId/settings" params={{ projectId }} search={{ section: 'search' }}>
              {t('dashboard.ai.settings')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {disabled ? (
        <Alert variant="info">
          <AlertDescription>
            {t('dashboard.ai.disabled')}{' '}
            <a className="underline" href="/docs/self-hosting/search-ai">
              {t('dashboard.ai.selfHosting')}
            </a>
          </AlertDescription>
        </Alert>
      ) : unavailable ? (
        <Alert variant="warning">
          <AlertDescription>
            {t('dashboard.ai.unavailable')}{' '}
            <Button variant="link" onClick={() => void active.refetch()}>
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : active.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {empty && <p className="rounded-xl border bg-card p-6 text-muted-foreground text-sm">{t('dashboard.ai.empty')}</p>}
          {search.tab === 'overview' && summary.data && <Overview data={summary.data} />}{' '}
          {search.tab === 'conversations' && (
            <>
              <ConversationList items={items} onOpen={(conversation) => onChange({ conversation })} />
              {list.hasNextPage && (
                <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {t('dashboard.ai.loadMore')}
                </Button>
              )}
            </>
          )}
          {search.tab === 'gaps' && gaps.data && (
            <ContentGaps projectId={projectId} items={gaps.data.items} onOpen={(conversation) => onChange({ conversation })} />
          )}
        </>
      )}
      <ConversationDetail projectId={projectId} conversation={search.conversation} onClose={() => onChange({ conversation: undefined })} />
    </div>
  );
}
