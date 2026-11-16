/**
 * How a Git connection's last sync and each operation show their raw status:
 * FAILED and CONFLICT as destructive, SUCCEEDED and READY as default, and any
 * other status (QUEUED, RUNNING or one this version doesn't know) as secondary.
 * The status text itself is shown as stored, untranslated.
 */
export const gitStatusTone = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' =>
  status === 'FAILED' || status === 'CONFLICT' ? 'destructive' : status === 'SUCCEEDED' || status === 'READY' ? 'default' : 'secondary';
