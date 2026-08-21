import { Badge } from '@nibleaf/design-system/components/ui/badge';

const HEALTHY = new Set(['ACTIVE', 'READY', 'SUCCEEDED', 'VERIFIED', 'active', 'healthy', 'COMPLETED', 'IDLE']);
const DANGER = new Set(['ERROR', 'FAILED', 'CONFLICT', 'CANCELLED', 'suspended', 'taken-down', 'expired']);
const PROGRESS = new Set(['PENDING', 'BUILDING', 'RUNNING', 'PROVISIONING', 'QUEUED']);

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const variant = DANGER.has(value) ? 'destructive' : HEALTHY.has(value) ? 'secondary' : PROGRESS.has(value) ? 'outline' : 'outline';
  return <Badge variant={variant}>{label ?? value.replaceAll('_', ' ').toLowerCase()}</Badge>;
}
