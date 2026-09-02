import type { RequestRow } from './types';

export function buildExportFilename(endpointId: string): string {
  return `webhook-requests-${endpointId}.json`;
}

export function serializeRequests(requests: RequestRow[]): string {
  return JSON.stringify(requests, null, 2);
}

// Triggers a browser download of the given contents — the DOM/Blob/URL
// APIs this needs only exist in a real browser, so it's kept as thin as
// possible; buildExportFilename/serializeRequests above hold the actual
// logic worth unit testing.
export function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
