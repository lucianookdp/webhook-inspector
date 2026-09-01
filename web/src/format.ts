export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

const METHOD_CLASSES: Record<string, string> = {
  GET: 'request-row__method--get',
  POST: 'request-row__method--post',
  PUT: 'request-row__method--put',
  PATCH: 'request-row__method--patch',
  DELETE: 'request-row__method--delete',
};

export function methodClass(method: string): string {
  return METHOD_CLASSES[method.toUpperCase()] ?? 'request-row__method--other';
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Expired';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
