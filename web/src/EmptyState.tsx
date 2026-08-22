import { useCopy } from './useCopy';

export function EmptyState({ url }: { url: string }) {
  const command = `curl -X POST ${url} -H "Content-Type: application/json" -d '{"hello":"world"}'`;
  const [copied, copy] = useCopy();

  return (
    <div className="empty-state">
      <p>No requests yet. Send one from your terminal:</p>
      <div className="empty-state__command">
        <pre>{command}</pre>
        <button type="button" onClick={() => copy(command)}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="empty-state__hint">Or register the URL above with any service that fires webhooks.</p>
    </div>
  );
}
