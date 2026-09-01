import type { RequestRow } from './types';
import { formatBytes, formatRelativeTime } from './format';
import { JsonView } from './JsonView';

function parseJsonBody(row: RequestRow): unknown | undefined {
  if (row.body_is_binary || row.body === null || row.body === '') return undefined;
  try {
    return JSON.parse(row.body);
  } catch {
    return undefined;
  }
}

function RequestDetail({ row }: { row: RequestRow }) {
  const jsonBody = parseJsonBody(row);

  return (
    <div className="request-detail">
      <div className="request-detail__meta">
        <span>{new Date(row.received_at).toISOString()}</span>
        <span title="Truncated to its /24 (IPv4) or /48 (IPv6) network — see the README">{row.ip ?? 'unknown ip'}</span>
        <span>{row.content_type ?? 'no content-type'}</span>
        <span>{formatBytes(row.size_bytes)}</span>
      </div>

      <section className="request-detail__section">
        <h3>Headers</h3>
        <JsonView value={row.headers} />
      </section>

      {Object.keys(row.query).length > 0 && (
        <section className="request-detail__section">
          <h3>Query</h3>
          <JsonView value={row.query} />
        </section>
      )}

      <section className="request-detail__section">
        <h3>Body</h3>
        {row.truncated && (
          <p className="request-detail__binary">
            truncated: actual body is {formatBytes(row.size_bytes)}, only the first 256 KB were stored
          </p>
        )}
        {row.body_is_binary ? (
          <>
            <p className="request-detail__binary">binary content, {formatBytes(row.size_bytes)}, base64-encoded below</p>
            <pre className="json-view">{row.body}</pre>
          </>
        ) : row.body === null || row.body === '' ? (
          <pre className="request-detail__empty-body">(empty body)</pre>
        ) : jsonBody !== undefined ? (
          <JsonView value={jsonBody} />
        ) : (
          <pre className="json-view">{row.body}</pre>
        )}
      </section>
    </div>
  );
}

export function RequestList({
  requests,
  selectedId,
  onSelect,
  newIds,
}: {
  requests: RequestRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  newIds: Set<string>;
}) {
  return (
    <div className="request-list">
      <div className="request-list__header">
        <span>Method</span>
        <span>Path</span>
        <span>Size</span>
        <span>Received</span>
      </div>
      {requests.map((row) => (
        <div
          key={row.id}
          className={newIds.has(row.id) ? 'request-list__item request-list__item--enter' : 'request-list__item'}
        >
          <button
            type="button"
            className="request-row"
            onClick={() => onSelect(selectedId === row.id ? null : row.id)}
            aria-expanded={selectedId === row.id}
          >
            <span className="request-row__method">{row.method}</span>
            <span className="request-row__path">{row.path}</span>
            <span className="request-row__size">{formatBytes(row.size_bytes)}</span>
            <span className="request-row__time">{formatRelativeTime(row.received_at)}</span>
          </button>
          {selectedId === row.id && <RequestDetail row={row} />}
        </div>
      ))}
    </div>
  );
}
