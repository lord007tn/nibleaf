import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Ban, Download, FileArchive, Play, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getData, mutateData } from '@/hooks/api/client-helpers';
import { api } from '@/lib/api';
import { SectionHeader } from './shared';

type ExportFormat = 'MARKDOWN' | 'PDF' | 'STATIC_HTML';
type ExportStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
interface ExportArtifact {
  id: string;
  format: ExportFormat;
  fileName: string;
  size: number;
}
interface ExportRun {
  id: string;
  formats: ExportFormat[];
  status: ExportStatus;
  trigger: 'MANUAL' | 'SCHEDULED';
  attempts: number;
  error: string | null;
  createdAt: string;
  snapshot: { deploymentVersion: number; pagesCount: number; createdAt: string };
  artifacts: ExportArtifact[];
  schedule: { id: string; name: string } | null;
}
interface ExportSchedule {
  id: string;
  name: string;
  formats: ExportFormat[];
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  timezone: string;
  hour: number;
  minute: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastError: string | null;
  retentionCount: number;
  retentionDays: number;
  _count: { jobs: number };
}

const labels: Record<ExportFormat, string> = { MARKDOWN: 'Markdown ZIP', PDF: 'PDF', STATIC_HTML: 'Static HTML ZIP' };
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const formatDate = (date: string | null) => (date ? new Date(date).toLocaleString() : '—');
const queryKey = (projectId: string, type: 'runs' | 'schedules') => ['projects', projectId, 'exports', type] as const;

export function ExportsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [formats, setFormats] = useState<ExportFormat[]>(['MARKDOWN']);
  const [showSchedule, setShowSchedule] = useState(false);
  const [surface, setSurface] = useState<'create' | 'schedules' | 'history'>('create');
  const runs = useQuery({
    queryKey: queryKey(projectId, 'runs'),
    queryFn: async () => getData<ExportRun[]>(await api.app.projects[':projectId'].exports.$get({ param: { projectId } }), 'export runs'),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === 'PENDING' || run.status === 'RUNNING') ? 2500 : false),
  });
  const schedules = useQuery({
    queryKey: queryKey(projectId, 'schedules'),
    queryFn: async () =>
      getData<ExportSchedule[]>(await api.app.projects[':projectId'].exports.schedules.$get({ param: { projectId } }), 'export schedules'),
  });
  const create = useMutation({
    mutationFn: async () =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports.$post({ param: { projectId }, json: { formats } }),
        'Could not queue the export.',
      ),
    onSuccess: () => {
      toast.success('Export queued from the latest published revision.');
      qc.invalidateQueries({ queryKey: queryKey(projectId, 'runs') });
    },
    onError: (error) => toast.error(error.message),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports[':id'].cancel.$post({ param: { projectId, id } }),
        'Could not cancel the export.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(projectId, 'runs') }),
    onError: (error) => toast.error(error.message),
  });
  const download = async (run: ExportRun, artifact: ExportArtifact) => {
    try {
      const result = await getData<{ url: string }>(
        await api.app.projects[':projectId'].exports[':id'].artifacts[':artifactId'].download.$get({
          param: { projectId, id: run.id, artifactId: artifact.id },
        }),
        'download URL',
      );
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download the export.');
    }
  };
  const toggleFormat = (format: ExportFormat) =>
    setFormats((current) =>
      current.includes(format) ? (current.length === 1 ? current : current.filter((item) => item !== format)) : [...current, format],
    );

  return (
    <div className="space-y-7">
      <SectionHeader icon="⇩" title="Exports" description="Portable exports are rendered in the background from one immutable published revision." />
      <nav aria-label="Export workflows" className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ['create', 'One-time export', 'Download the latest published revision'],
            ['schedules', 'Schedules', 'Automate archival snapshots and retention'],
            ['history', 'Run history', 'Monitor, recover, and download artifacts'],
          ] as const
        ).map(([value, title, description]) => (
          <button
            aria-pressed={surface === value}
            className={`rounded-lg border p-3 text-start transition-colors ${surface === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            key={value}
            onClick={() => setSurface(value)}
            type="button"
          >
            <span className="block font-medium text-sm">{title}</span>
            <span className="mt-1 block text-muted-foreground text-xs">{description}</span>
          </button>
        ))}
      </nav>
      {runs.isError || schedules.isError ? (
        <div aria-live="polite" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
          Export data could not be loaded. Check the connection and try this page again.
        </div>
      ) : null}
      {surface === 'create' ? (
        <section className="space-y-3">
          <div className="font-semibold text-sm">Create export</div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap gap-3">
              {(Object.keys(labels) as ExportFormat[]).map((format) => (
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm" key={format}>
                  <input checked={formats.includes(format)} onChange={() => toggleFormat(format)} type="checkbox" /> {labels[format]}
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                PDF uses print-safe typography and RTL; static HTML includes offline navigation, search, themes, and assets.
              </p>
              <Button disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <FileArchive className="size-3.5" />} Create export
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {surface === 'schedules' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">Archive schedules</div>
            <Button onClick={() => setShowSchedule((value) => !value)} size="sm" variant="outline">
              <Plus className="size-3.5" /> New schedule
            </Button>
          </div>
          {showSchedule ? (
            <ScheduleForm
              projectId={projectId}
              onCreated={() => {
                setShowSchedule(false);
                qc.invalidateQueries({ queryKey: queryKey(projectId, 'schedules') });
              }}
            />
          ) : null}
          <div className="space-y-2">
            {schedules.data?.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                projectId={projectId}
                schedule={schedule}
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: queryKey(projectId, 'schedules') });
                  qc.invalidateQueries({ queryKey: queryKey(projectId, 'runs') });
                }}
              />
            ))}
            {!schedules.isLoading && !schedules.data?.length ? (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <Archive className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 font-medium text-sm">No archival schedules</p>
                <p className="mt-1 text-muted-foreground text-xs">Create one when exports need to run automatically across time zones.</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {surface === 'history' ? (
        <section className="space-y-3">
          <div className="font-semibold text-sm">Run history</div>
          <div className="space-y-2">
            {runs.data?.map((run) => (
              <div className="rounded-lg border border-border p-4" key={run.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Archive className="size-4" />
                      {run.formats.map((format) => labels[format]).join(', ')} <StatusBadge status={run.status} />
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      Published v{run.snapshot.deploymentVersion} · {run.snapshot.pagesCount} pages ·{' '}
                      {run.trigger === 'SCHEDULED' ? (run.schedule?.name ?? 'Scheduled') : 'Manual'} · {formatDate(run.createdAt)}
                    </div>
                  </div>
                  {run.status === 'PENDING' || run.status === 'RUNNING' ? (
                    <Button disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)} size="sm" variant="outline">
                      <Ban className="size-3.5" /> Cancel
                    </Button>
                  ) : null}
                </div>
                {run.error ? (
                  <p className="mt-3 rounded-md bg-destructive/10 p-2 text-destructive text-xs">
                    Attempt {run.attempts}: {run.error}
                  </p>
                ) : null}
                {run.artifacts.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {run.artifacts.map((artifact) => (
                      <Button key={artifact.id} onClick={() => download(run, artifact)} size="sm" variant="outline">
                        <Download className="size-3.5" /> {labels[artifact.format]} · {sizeLabel(artifact.size)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!runs.isLoading && !runs.data?.length ? (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <FileArchive className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 font-medium text-sm">No export runs yet</p>
                <p className="mt-1 text-muted-foreground text-xs">Create a one-time export or run a schedule to see status and downloads here.</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {surface === 'create' ? (
        <p className="text-muted-foreground text-xs">
          Need the legacy all-drafts archive?{' '}
          <a className="underline" download href={`/api/app/projects/${projectId}/export`}>
            Download the original Markdown ZIP
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: ExportStatus }) {
  return <Badge variant={status === 'FAILED' ? 'destructive' : status === 'SUCCEEDED' ? 'default' : 'secondary'}>{status.toLowerCase()}</Badge>;
}

function ScheduleForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [name, setName] = useState('Nightly archive');
  const [cadence, setCadence] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [time, setTime] = useState('02:00');
  const [weekday, setWeekday] = useState(1);
  const [monthday, setMonthday] = useState(1);
  const [retentionCount, setRetentionCount] = useState(12);
  const [retentionDays, setRetentionDays] = useState(90);
  const [scheduleFormats, setScheduleFormats] = useState<ExportFormat[]>(['MARKDOWN', 'PDF', 'STATIC_HTML']);
  const toggleScheduleFormat = (format: ExportFormat) =>
    setScheduleFormats((current) =>
      current.includes(format) ? (current.length === 1 ? current : current.filter((item) => item !== format)) : [...current, format],
    );
  const create = useMutation({
    mutationFn: async () => {
      const [hour, minute] = time.split(':').map(Number);
      return mutateData(
        await api.app.projects[':projectId'].exports.schedules.$post({
          param: { projectId },
          json: {
            name,
            formats: scheduleFormats,
            cadence,
            timezone,
            hour: hour ?? 2,
            minute: minute ?? 0,
            ...(cadence === 'WEEKLY' ? { weekday } : {}),
            ...(cadence === 'MONTHLY' ? { monthday } : {}),
            retentionCount,
            retentionDays,
          },
        }),
        'Could not create the schedule.',
      );
    },
    onSuccess: () => {
      toast.success('Archive schedule created.');
      onCreated();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
      <Input aria-label="Schedule name" onChange={(event) => setName(event.target.value)} value={name} />
      <Input aria-label="IANA timezone" onChange={(event) => setTimezone(event.target.value)} value={timezone} />
      <select
        className="h-9 rounded-md border bg-background px-3 text-sm"
        onChange={(event) => setCadence(event.target.value as typeof cadence)}
        value={cadence}
      >
        <option value="DAILY">Daily</option>
        <option value="WEEKLY">Weekly</option>
        <option value="MONTHLY">Monthly</option>
      </select>
      <Input aria-label="Local run time" onChange={(event) => setTime(event.target.value)} type="time" value={time} />
      {cadence === 'WEEKLY' ? (
        <select
          aria-label="Weekday"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          onChange={(event) => setWeekday(Number(event.target.value))}
          value={weekday}
        >
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
          <option value={2}>Tuesday</option>
          <option value={3}>Wednesday</option>
          <option value={4}>Thursday</option>
          <option value={5}>Friday</option>
          <option value={6}>Saturday</option>
        </select>
      ) : null}
      {cadence === 'MONTHLY' ? (
        <Input
          aria-label="Day of month"
          max={31}
          min={1}
          onChange={(event) => setMonthday(Number(event.target.value))}
          type="number"
          value={monthday}
        />
      ) : null}
      <Input
        aria-label="Runs to retain"
        max={100}
        min={1}
        onChange={(event) => setRetentionCount(Number(event.target.value))}
        type="number"
        value={retentionCount}
      />
      <Input
        aria-label="Retention days"
        max={3650}
        min={1}
        onChange={(event) => setRetentionDays(Number(event.target.value))}
        type="number"
        value={retentionDays}
      />
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {(Object.keys(labels) as ExportFormat[]).map((format) => (
          <label className="flex items-center gap-1.5 text-xs" key={format}>
            <input checked={scheduleFormats.includes(format)} onChange={() => toggleScheduleFormat(format)} type="checkbox" />
            {labels[format]}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end sm:col-span-2">
        <Button disabled={!name.trim() || !timezone.trim() || create.isPending} onClick={() => create.mutate()} size="sm">
          Create schedule
        </Button>
      </div>
    </div>
  );
}

function ScheduleRow({ projectId, schedule, onChanged }: { projectId: string; schedule: ExportSchedule; onChanged: () => void }) {
  const update = useMutation({
    mutationFn: async () =>
      mutateData(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].$patch({
          param: { projectId, scheduleId: schedule.id },
          json: { enabled: !schedule.enabled },
        }),
        'Could not update the schedule.',
      ),
    onSuccess: onChanged,
    onError: (error) => toast.error(error.message),
  });
  const run = useMutation({
    mutationFn: async () =>
      mutateData(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].run.$post({ param: { projectId, scheduleId: schedule.id } }),
        'Could not run the schedule.',
      ),
    onSuccess: () => {
      toast.success('Archive run queued.');
      onChanged();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <div className="flex items-center gap-2 font-medium text-sm">
          {schedule.name}
          <Badge variant="secondary">{schedule.enabled ? 'enabled' : 'disabled'}</Badge>
        </div>
        <div className="mt-1 text-muted-foreground text-xs">
          {schedule.cadence.toLowerCase()} at {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')} {schedule.timezone}{' '}
          · next {formatDate(schedule.nextRunAt)} · {schedule._count.jobs} runs
        </div>
        {schedule.lastError ? <div className="mt-1 text-destructive text-xs">{schedule.lastError}</div> : null}
      </div>
      <div className="flex gap-2">
        <Button disabled={run.isPending} onClick={() => run.mutate()} size="sm" variant="outline">
          <Play className="size-3.5" /> Run now
        </Button>
        <Button disabled={update.isPending} onClick={() => update.mutate()} size="sm" variant="outline">
          {schedule.enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>
    </div>
  );
}
