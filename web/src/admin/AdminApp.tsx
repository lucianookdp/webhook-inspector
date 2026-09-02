import { useEffect, useState } from 'react';
import { AdminApiError, fetchUsageStats, type UsageStats } from './adminApi';

const STORAGE_KEY = 'portaria:admin-token';

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [tokenInput, setTokenInput] = useState('');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchUsageStats(token)
      .then((data) => {
        if (cancelled) return;
        setStats(data);
      })
      .catch((err) => {
        if (cancelled) return;
        // A stored token that no longer works (rotated, or this deployment
        // never had one configured) shouldn't keep failing silently on
        // every reload — clear it and drop back to the unlock form.
        if (err instanceof AdminApiError && err.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          setToken(null);
        }
        setError(err instanceof Error ? err.message : 'Could not load stats.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function unlock() {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setToken(trimmed);
    setTokenInput('');
  }

  function lock() {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setStats(null);
  }

  if (!token) {
    return (
      <div className="admin admin--gate">
        <h1>Admin</h1>
        <p className="admin__hint">Enter the admin token to view usage stats.</p>
        <div className="admin__unlock-row">
          <input
            type="password"
            className="admin__unlock-input"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && unlock()}
            placeholder="Admin token"
            // biome-ignore lint/a11y/noAutofocus: the only interactive element on this page on load
            autoFocus
          />
          <button type="button" onClick={unlock} disabled={!tokenInput.trim()}>
            Unlock
          </button>
        </div>
        {error && <p className="admin__error">{error}</p>}
      </div>
    );
  }

  const maxCaptured = Math.max(1, ...(stats?.daily.map((d) => d.requestsCaptured) ?? [0]));

  return (
    <div className="admin">
      <div className="admin__header">
        <h1>Admin</h1>
        <button type="button" className="admin__lock" onClick={lock}>
          Lock
        </button>
      </div>

      {loading && !stats && <p className="admin__hint">Loading...</p>}
      {error && <p className="admin__error">{error}</p>}

      {stats && (
        <>
          <div className="admin__totals">
            <div className="admin__stat">
              <span className="admin__stat-value">{stats.activeEndpoints}</span>
              <span className="admin__stat-label">active endpoints right now</span>
            </div>
            <div className="admin__stat">
              <span className="admin__stat-value">{stats.totalEndpointsCreated}</span>
              <span className="admin__stat-label">endpoints created (all time)</span>
            </div>
            <div className="admin__stat">
              <span className="admin__stat-value">{stats.totalRequestsCaptured}</span>
              <span className="admin__stat-label">requests captured (all time)</span>
            </div>
          </div>

          <h2 className="admin__section-title">Last 30 days</h2>
          {stats.daily.length === 0 ? (
            <p className="admin__hint">No activity recorded yet.</p>
          ) : (
            <table className="admin__table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Endpoints created</th>
                  <th>Requests captured</th>
                </tr>
              </thead>
              <tbody>
                {stats.daily.map((day) => (
                  <tr key={day.day}>
                    <td>{day.day}</td>
                    <td>{day.endpointsCreated}</td>
                    <td>
                      <div className="admin__bar-cell">
                        <div
                          className="admin__bar"
                          style={{ width: `${(day.requestsCaptured / maxCaptured) * 100}%` }}
                        />
                        <span>{day.requestsCaptured}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
