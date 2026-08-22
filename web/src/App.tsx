import { useEffect, useState } from 'react';
import { ApiError, createEndpoint, endpointUrl, fetchRequests, streamUrl } from './api';
import type { EndpointInfo, RequestRow } from './types';
import { EmptyState } from './EmptyState';
import { RequestList } from './RequestList';
import { useCopy } from './useCopy';

const STORAGE_KEY = 'portaria:endpoint';

function loadStoredEndpoint(): EndpointInfo | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EndpointInfo;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeEndpoint(endpoint: EndpointInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoint));
}

function clearStoredEndpoint() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function App() {
  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(() => loadStoredEndpoint());
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [copied, copy] = useCopy();

  // History loads from the database first; only once it has resolved does the
  // SSE stream open, so a request that arrived while nobody was watching is
  // never missed and never shown twice.
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    let source: EventSource | undefined;

    setLoading(true);
    setError(null);

    fetchRequests(endpoint.id)
      .then((rows) => {
        if (cancelled) return;
        setRequests(rows);
        source = new EventSource(streamUrl(endpoint.id));
        source.onmessage = (event) => {
          const row = JSON.parse(event.data) as RequestRow;
          setRequests((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
          setNewIds((prev) => new Set(prev).add(row.id));
          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
          }, 300);
        };
        // Browsers retry a dropped EventSource forever by default; that's
        // wasted effort against an endpoint that just expired, so stop it
        // and surface the state instead of retrying silently.
        source.onerror = () => {
          source?.close();
          setError('Live connection lost. Reload the page to reconnect.');
        };
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 410) {
          clearStoredEndpoint();
          setEndpoint(null);
          setError('This URL expired. Generate a new one.');
        } else if (err instanceof ApiError && err.status === 404) {
          clearStoredEndpoint();
          setEndpoint(null);
          setError('This URL was not found. Generate a new one.');
        } else {
          setError('Could not load request history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [endpoint]);

  async function handleGenerate() {
    setError(null);
    try {
      const created = await createEndpoint();
      storeEndpoint(created);
      setEndpoint(created);
      setRequests([]);
      setSelectedId(null);
    } catch {
      setError('Could not generate a new URL. Try again.');
    }
  }

  const url = endpoint ? endpointUrl(endpoint.id) : null;

  return (
    <div className="app">
      <section className="url-panel">
        {url && endpoint ? (
          <>
            <div className="url-panel__row">
              <code className="url-panel__url">{url}</code>
              <button type="button" onClick={() => copy(url)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="url-panel__meta">
              <span>Expires {new Date(endpoint.expiresAt).toLocaleString()}</span>
              <button type="button" className="url-panel__new" onClick={handleGenerate}>
                New URL
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="url-panel__generate" onClick={handleGenerate}>
            Generate URL
          </button>
        )}
        {error && <p className="app__error">{error}</p>}
      </section>

      {endpoint && (
        <section className="app__body">
          {loading ? (
            <p className="app__status">Loading history...</p>
          ) : requests.length === 0 ? (
            <EmptyState url={url!} />
          ) : (
            <RequestList requests={requests} selectedId={selectedId} onSelect={setSelectedId} newIds={newIds} />
          )}
        </section>
      )}
    </div>
  );
}
