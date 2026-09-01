import { useEffect, useState } from 'react';
import { ApiError, createEndpoint, endpointUrl, fetchRequests, streamUrl } from './api';
import { EmptyState } from './EmptyState';
import { formatCountdown } from './format';
import { RequestList } from './RequestList';
import type { EndpointInfo, RequestRow } from './types';
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

function creationErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    return 'Too many URLs created recently from your network. Try again in a few minutes.';
  }
  return 'Could not create a URL. Check your connection and try again.';
}

export default function App() {
  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(() => loadStoredEndpoint());
  const [creating, setCreating] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [copied, copy] = useCopy();

  async function createNewEndpoint() {
    setCreating(true);
    setError(null);
    try {
      const created = await createEndpoint();
      storeEndpoint(created);
      setEndpoint(created);
      setRequests([]);
      setNextCursor(null);
      setDroppedCount(0);
      setSelectedId(null);
    } catch (err) {
      setError(creationErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  // A first-time visitor should land on a working URL, not a button: if
  // nothing was already stored, create one automatically. handleGenerate
  // (the "New URL" button) covers the explicit re-create case afterwards.
  // This is deliberately mount-only — it must not re-run as `endpoint`
  // changes afterwards, so `createNewEndpoint`/`endpoint` are left out of
  // the dependency list on purpose rather than by oversight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design, see comment above
  useEffect(() => {
    if (!endpoint) void createNewEndpoint();
  }, []);

  // Ticks the countdown to expiry; only runs while there's an endpoint to
  // count down for, so it doesn't keep the tab alive for no reason.
  useEffect(() => {
    if (!endpoint) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [endpoint]);

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
      .then((page) => {
        if (cancelled) return;
        setRequests(page.items);
        setNextCursor(page.nextCursor);
        setDroppedCount(page.droppedCount);
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

  // Fires straight from the browser at the user's own endpoint — no server
  // involvement beyond capturing it like any other request — so the first
  // row shows up within about a second of landing on the page, over the
  // SSE connection the history-load effect above already opened.
  async function handleSendTestRequest() {
    if (!endpoint) return;
    setSendingTest(true);
    try {
      await fetch(endpointUrl(endpoint.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test.request',
          message: 'Hello from your browser — this is what a captured request looks like.',
          sentAt: new Date().toISOString(),
        }),
      });
    } catch {
      setError('Could not send the test request. Check your connection.');
    } finally {
      setSendingTest(false);
    }
  }

  async function handleLoadMore() {
    if (!endpoint || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchRequests(endpoint.id, nextCursor);
      setRequests((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setDroppedCount(page.droppedCount);
    } catch {
      setError('Could not load more requests.');
    } finally {
      setLoadingMore(false);
    }
  }

  const url = endpoint ? endpointUrl(endpoint.id) : null;
  const remainingMs = endpoint ? new Date(endpoint.expiresAt).getTime() - now : 0;

  return (
    <div className="app">
      <p className="app__pitch">
        Send any HTTP request to the URL below and watch it appear here right away — it stops working after 24 hours, so
        nothing lingers.
      </p>

      <section className="url-panel">
        {url && endpoint ? (
          <>
            <div className="url-panel__row">
              <code className="url-panel__url">{url}</code>
              <button type="button" className="url-panel__copy" onClick={() => copy(url)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="url-panel__meta">
              <span>Expires in {formatCountdown(remainingMs)}</span>
              <button type="button" className="url-panel__new" onClick={createNewEndpoint} disabled={creating}>
                {creating ? 'Generating...' : 'New URL'}
              </button>
            </div>
          </>
        ) : (
          <div className="url-panel__pending">
            {creating ? (
              <p className="app__status">Generating your URL...</p>
            ) : (
              <button type="button" className="url-panel__generate" onClick={createNewEndpoint}>
                Try again
              </button>
            )}
          </div>
        )}
        {error && <p className="app__error">{error}</p>}
      </section>

      {endpoint && (
        <button type="button" className="app__test-request" onClick={handleSendTestRequest} disabled={sendingTest}>
          {sendingTest ? 'Sending...' : 'Send a test request'}
        </button>
      )}

      {endpoint && (
        <section className="app__body">
          {loading ? (
            <p className="app__status">Loading history...</p>
          ) : requests.length === 0 ? (
            <EmptyState url={endpointUrl(endpoint.id)} />
          ) : (
            <>
              {droppedCount > 0 && (
                <p className="app__dropped-notice">
                  {droppedCount} older {droppedCount === 1 ? 'request was' : 'requests were'} discarded to stay under
                  the per-endpoint storage limit.
                </p>
              )}
              <RequestList
                requests={requests}
                selectedId={selectedId}
                onSelect={setSelectedId}
                newIds={newIds}
                now={now}
              />
              {nextCursor && (
                <button type="button" className="app__load-more" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
