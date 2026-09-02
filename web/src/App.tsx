import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createEndpoint, endpointUrl, fetchRequests, type ResponseConfig, streamUrl } from './api';
import { computeBackoffDelay } from './backoff';
import { EmptyState } from './EmptyState';
import { buildExportFilename, downloadJson, serializeRequests } from './exportRequests';
import { FilterBar } from './FilterBar';
import { matchesFilter } from './filterRequests';
import { formatCountdown } from './format';
import { mergeMissedRequests } from './mergeRequests';
import { RequestList } from './RequestList';
import { ResponseConfigControl } from './ResponseConfig';
import { SigningSecret } from './SigningSecret';
import type { EndpointInfo, RequestRow } from './types';
import { useCopy } from './useCopy';

const DEFAULT_RESPONSE_CONFIG: ResponseConfig = { status: null, body: null, contentType: null };

const STORAGE_KEY = 'portaria:endpoint';

type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'expired';

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

// A stored endpoint reference can be unusable for reasons beyond just having
// expired (410) or been deleted (404) — a malformed id left over from a
// stale build or manual localStorage edit fails schema validation (400).
// All three mean the same thing to the user: this URL doesn't work anymore,
// so generate a new one instead of getting stuck showing a dead link.
function isUnusableEndpointError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 410);
}

function unusableEndpointMessage(status: number): string {
  if (status === 410) return 'This URL expired. Generate a new one.';
  return 'This URL was not found. Generate a new one.';
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
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [announcement, setAnnouncement] = useState('');
  const [signingSecretConfigured, setSigningSecretConfigured] = useState(false);
  const [responseConfig, setResponseConfigState] = useState<ResponseConfig>(DEFAULT_RESPONSE_CONFIG);
  const [filterMethod, setFilterMethod] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [copied, copy] = useCopy();

  // Filters over whatever's already loaded (see filterRequests.ts for why
  // this is client-side rather than a server round trip) — recomputed only
  // when the list or the filter actually changes, not on every render.
  const filteredRequests = useMemo(
    () => requests.filter((row) => matchesFilter(row, filterMethod, filterQuery)),
    [requests, filterMethod, filterQuery],
  );

  // The SSE effect below only depends on [endpoint], so its closure would
  // otherwise see a stale `requests` from whenever it last ran; reconnect()
  // needs the current list to compute what a refetch actually missed.
  const requestsRef = useRef<RequestRow[]>(requests);
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

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
      setSigningSecretConfigured(false);
      setResponseConfigState(DEFAULT_RESPONSE_CONFIG);
      setFilterMethod('');
      setFilterQuery('');
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
  // never missed and never shown twice. A dropped connection reconnects on
  // its own with backoff instead of giving up, refetching the latest page
  // first each time to catch up on anything that arrived while offline —
  // only a 410 (the endpoint itself expired) stops the retries for good.
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    let source: EventSource | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let retryCount = 0;

    function attachHandlers(es: EventSource) {
      es.onopen = () => {
        retryCount = 0;
        setConnectionState('live');
      };
      es.onmessage = (event) => {
        const row = JSON.parse(event.data) as RequestRow;
        setRequests((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        setNewIds((prev) => new Set(prev).add(row.id));
        setAnnouncement(`New ${row.method} request to ${row.path}`);
        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev);
            next.delete(row.id);
            return next;
          });
        }, 300);
      };
      es.onerror = () => {
        es.close();
        if (cancelled) return;
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      setConnectionState('reconnecting');
      const delay = computeBackoffDelay(retryCount);
      retryCount += 1;
      retryTimeout = setTimeout(() => void reconnect(), delay);
    }

    async function reconnect() {
      if (cancelled || !endpoint) return;
      try {
        const page = await fetchRequests(endpoint.id);
        if (cancelled) return;
        const merged = mergeMissedRequests(requestsRef.current, page.items);
        const missedCount = merged.length - requestsRef.current.length;
        setRequests(merged);
        if (missedCount > 0) {
          setAnnouncement(`${missedCount} ${missedCount === 1 ? 'request' : 'requests'} received while reconnecting`);
        }
        setDroppedCount(page.droppedCount);
        setSigningSecretConfigured(page.signingSecretConfigured);
        setResponseConfigState(page.responseConfig);
        source = new EventSource(streamUrl(endpoint.id));
        attachHandlers(source);
      } catch (err) {
        if (cancelled) return;
        if (isUnusableEndpointError(err)) {
          clearStoredEndpoint();
          setEndpoint(null);
          setConnectionState('expired');
          setError(unusableEndpointMessage(err.status));
          return;
        }
        scheduleReconnect();
      }
    }

    setLoading(true);
    setError(null);
    setConnectionState('connecting');

    fetchRequests(endpoint.id)
      .then((page) => {
        if (cancelled) return;
        setRequests(page.items);
        setNextCursor(page.nextCursor);
        setDroppedCount(page.droppedCount);
        setSigningSecretConfigured(page.signingSecretConfigured);
        setResponseConfigState(page.responseConfig);
        source = new EventSource(streamUrl(endpoint.id));
        attachHandlers(source);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isUnusableEndpointError(err)) {
          clearStoredEndpoint();
          setEndpoint(null);
          setError(unusableEndpointMessage(err.status));
        } else {
          setError('Could not load request history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
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

  // Exports whatever's currently loaded and matching the active filter —
  // the same rows on screen — rather than silently fetching the rest of the
  // endpoint's history first; "Load more" is the explicit way to widen that
  // before exporting.
  function handleExport() {
    if (!endpoint || filteredRequests.length === 0) return;
    downloadJson(buildExportFilename(endpoint.id), serializeRequests(filteredRequests));
  }

  const url = endpoint ? endpointUrl(endpoint.id) : null;
  const remainingMs = endpoint ? new Date(endpoint.expiresAt).getTime() - now : 0;

  return (
    <div className="app">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
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

      {endpoint && connectionState !== 'expired' && (
        <div className={`connection-indicator connection-indicator--${connectionState}`}>
          <span className="connection-indicator__dot" />
          {connectionState === 'live' && 'Live'}
          {connectionState === 'connecting' && 'Connecting...'}
          {connectionState === 'reconnecting' && 'Reconnecting...'}
        </div>
      )}

      {endpoint && (
        <SigningSecret
          endpointId={endpoint.id}
          configured={signingSecretConfigured}
          onChange={setSigningSecretConfigured}
        />
      )}

      {endpoint && (
        <ResponseConfigControl endpointId={endpoint.id} config={responseConfig} onChange={setResponseConfigState} />
      )}

      {endpoint && (
        <section className="app__body">
          {loading ? (
            <p className="app__status">Loading history...</p>
          ) : requests.length === 0 ? (
            <EmptyState url={endpointUrl(endpoint.id)} />
          ) : (
            <>
              <div className="list-toolbar">
                <FilterBar
                  method={filterMethod}
                  query={filterQuery}
                  onMethodChange={setFilterMethod}
                  onQueryChange={setFilterQuery}
                />
                <button
                  type="button"
                  className="list-toolbar__export"
                  onClick={handleExport}
                  disabled={filteredRequests.length === 0}
                >
                  Export JSON
                </button>
              </div>
              {droppedCount > 0 && (
                <p className="app__dropped-notice">
                  {droppedCount} older {droppedCount === 1 ? 'request was' : 'requests were'} discarded to stay under
                  the per-endpoint storage limit.
                </p>
              )}
              {filteredRequests.length === 0 ? (
                <p className="app__status">No requests match this filter.</p>
              ) : (
                <RequestList
                  requests={filteredRequests}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  newIds={newIds}
                  now={now}
                  endpointId={endpoint.id}
                />
              )}
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
