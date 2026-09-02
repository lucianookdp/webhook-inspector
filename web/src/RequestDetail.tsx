import { type FormEvent, useState } from 'react';
import { ApiError, type ForwardResult, forwardRequest } from './api';
import { type BodyKind, detectBodyKind, parseFormBody, prettyPrintXml, stringifyFieldValue } from './bodyKind';
import { formatBytes } from './format';
import { JsonView } from './JsonView';
import type { RequestRow } from './types';
import { useCopy } from './useCopy';

type Tab = 'pretty' | 'raw' | 'headers' | 'query' | 'forward';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'pretty', label: 'Pretty' },
  { id: 'raw', label: 'Raw' },
  { id: 'headers', label: 'Headers' },
  { id: 'query', label: 'Query' },
  { id: 'forward', label: 'Forward' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" className="request-detail__copy" onClick={() => copy(text)}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function KeyValueTable({
  pairs,
  emptyMessage,
  copyText,
}: {
  pairs: Array<[string, string]>;
  emptyMessage: string;
  copyText: string;
}) {
  return (
    <div className="request-detail__tab-panel">
      <div className="request-detail__panel-toolbar">
        <CopyButton text={copyText} />
      </div>
      {pairs.length === 0 ? (
        <p className="request-detail__empty-body">{emptyMessage}</p>
      ) : (
        <table className="kv-table">
          <tbody>
            {pairs.map(([key, value], index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: header/query names can repeat; index keeps rows stable
              <tr key={`${key}-${index}`}>
                <td className="kv-table__key">{key}</td>
                <td className="kv-table__value">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PrettyBody({ row, kind }: { row: RequestRow; kind: BodyKind }) {
  if (kind === 'empty') return <p className="request-detail__empty-body">(empty body)</p>;
  if (kind === 'binary') {
    return (
      <p className="request-detail__binary">
        binary content, {formatBytes(row.size_bytes)} — see the Raw tab for the base64 encoding
      </p>
    );
  }

  const body = row.body ?? '';

  if (kind === 'json') {
    try {
      return <JsonView value={JSON.parse(body)} />;
    } catch {
      return <pre className="json-view">{body}</pre>;
    }
  }
  if (kind === 'form') {
    const pairs = parseFormBody(body);
    return pairs.length === 0 ? (
      <p className="request-detail__empty-body">(no fields)</p>
    ) : (
      <table className="kv-table">
        <tbody>
          {pairs.map(([key, value], index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: form field names can repeat; index keeps rows stable
            <tr key={`${key}-${index}`}>
              <td className="kv-table__key">{key}</td>
              <td className="kv-table__value">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (kind === 'xml') return <pre className="json-view">{prettyPrintXml(body)}</pre>;
  return <pre className="json-view">{body}</pre>;
}

function prettyText(row: RequestRow, kind: BodyKind): string {
  if (kind === 'empty') return '';
  const body = row.body ?? '';
  if (kind === 'binary') return body;
  if (kind === 'json') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (kind === 'xml') return prettyPrintXml(body);
  if (kind === 'form') {
    return parseFormBody(body)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }
  return body;
}

function RawBody({ row }: { row: RequestRow }) {
  if (row.body === null || row.body === '') return <p className="request-detail__empty-body">(empty body)</p>;
  if (row.body_is_binary) {
    return (
      <>
        <p className="request-detail__binary">base64-encoded binary, {formatBytes(row.size_bytes)}</p>
        <pre className="json-view">{row.body}</pre>
      </>
    );
  }
  return <pre className="json-view">{row.body}</pre>;
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400) return 'error';
  return 'neutral';
}

function ForwardPanel({ endpointId, requestId }: { endpointId: string; requestId: string }) {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ForwardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const target = url.trim();
    if (!target || submitting) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await forwardRequest(endpointId, requestId, target));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not forward the request. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="forward-panel">
      <p className="forward-panel__intro">Re-send this request's method, headers, and body to another URL.</p>
      <form className="forward-panel__form" onSubmit={handleSubmit}>
        <input
          type="url"
          className="forward-panel__input"
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <button type="submit" className="forward-panel__submit" disabled={submitting}>
          {submitting ? 'Sending...' : 'Forward'}
        </button>
      </form>
      {error && <p className="forward-panel__error">{error}</p>}
      {result && (
        <div className="forward-panel__result">
          <div className="forward-panel__result-meta">
            <span className={`forward-panel__status forward-panel__status--${statusClass(result.status)}`}>
              {result.status}
            </span>
            <span>{result.durationMs}ms</span>
            {result.bodyTruncated && <span>response truncated to 256 KB</span>}
          </div>
          {Object.keys(result.headers).length > 0 && (
            <table className="kv-table">
              <tbody>
                {Object.entries(result.headers).map(([key, value]) => (
                  <tr key={key}>
                    <td className="kv-table__key">{key}</td>
                    <td className="kv-table__value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.body ? (
            <pre className="json-view">{result.body}</pre>
          ) : (
            <p className="request-detail__empty-body">(empty response body)</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RequestDetail({ row, endpointId }: { row: RequestRow; endpointId: string }) {
  const [tab, setTab] = useState<Tab>('pretty');
  const kind = detectBodyKind(row);
  const headerPairs = Object.entries(row.headers).map((entry): [string, string] => [
    entry[0],
    stringifyFieldValue(entry[1]),
  ]);
  const queryPairs = Object.entries(row.query).map((entry): [string, string] => [
    entry[0],
    stringifyFieldValue(entry[1]),
  ]);

  return (
    <div className="request-detail">
      <div className="request-detail__meta">
        <span>{new Date(row.received_at).toISOString()}</span>
        <span title="Truncated to its /24 (IPv4) or /48 (IPv6) network — see the README">{row.ip ?? 'unknown ip'}</span>
        <span>{row.content_type ?? 'no content-type'}</span>
        <span>{formatBytes(row.size_bytes)}</span>
      </div>

      {row.truncated && (
        <p className="request-detail__binary">
          truncated: actual body is {formatBytes(row.size_bytes)}, only the first 256 KB were stored
        </p>
      )}

      <div className="request-detail__tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'request-detail__tab request-detail__tab--active' : 'request-detail__tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="request-detail__panel">
        {tab === 'pretty' && (
          <div className="request-detail__tab-panel">
            <div className="request-detail__panel-toolbar">
              <CopyButton text={prettyText(row, kind)} />
            </div>
            <PrettyBody row={row} kind={kind} />
          </div>
        )}
        {tab === 'raw' && (
          <div className="request-detail__tab-panel">
            <div className="request-detail__panel-toolbar">
              <CopyButton text={row.body ?? ''} />
            </div>
            <RawBody row={row} />
          </div>
        )}
        {tab === 'headers' && (
          <KeyValueTable
            pairs={headerPairs}
            emptyMessage="(no headers)"
            copyText={headerPairs.map(([key, value]) => `${key}: ${value}`).join('\n')}
          />
        )}
        {tab === 'query' && (
          <KeyValueTable
            pairs={queryPairs}
            emptyMessage="(no query parameters)"
            copyText={queryPairs.map(([key, value]) => `${key}=${value}`).join('\n')}
          />
        )}
        {tab === 'forward' && <ForwardPanel endpointId={endpointId} requestId={row.id} />}
      </div>
    </div>
  );
}
