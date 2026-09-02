import { useState } from 'react';
import { type ResponseConfig, setResponseConfig } from './api';

const DEFAULT_CONFIG: ResponseConfig = { status: null, body: null, contentType: null };

function isCustomized(config: ResponseConfig): boolean {
  return config.status !== null || config.body !== null || config.contentType !== null;
}

export function ResponseConfigControl({
  endpointId,
  config,
  onChange,
}: {
  endpointId: string;
  config: ResponseConfig;
  onChange: (config: ResponseConfig) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  const [body, setBody] = useState('');
  const [contentType, setContentType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setStatus(config.status !== null ? String(config.status) : '');
    setBody(config.body ?? '');
    setContentType(config.contentType ?? '');
    setError(null);
    setEditing(true);
  }

  async function save(next: ResponseConfig) {
    setSaving(true);
    setError(null);
    try {
      await setResponseConfig(endpointId, next);
      onChange(next);
      setEditing(false);
    } catch {
      setError('Could not save. Check your connection.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const customized = isCustomized(config);
    return (
      <div className="response-config">
        <span className="response-config__status">
          Response: {customized ? `${config.status ?? 200} (custom)` : '200 (default)'}
        </span>
        <button type="button" className="response-config__link" onClick={startEditing}>
          {customized ? 'Change response' : 'Customize response'}
        </button>
        {customized && (
          <button
            type="button"
            className="response-config__link"
            onClick={() => save(DEFAULT_CONFIG)}
            disabled={saving}
          >
            Reset to default
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="response-config response-config--editing">
      <div className="response-config__row">
        <label className="response-config__field">
          Status
          <input
            type="number"
            className="response-config__status-input"
            min={200}
            max={599}
            placeholder="200"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          />
        </label>
        <label className="response-config__field">
          Content-Type
          <input
            type="text"
            className="response-config__content-type-input"
            placeholder="application/json"
            value={contentType}
            onChange={(event) => setContentType(event.target.value)}
          />
        </label>
      </div>
      <textarea
        className="response-config__body-input"
        placeholder="Response body — leave empty for the default &quot;ok&quot;"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
      />
      <div className="response-config__actions">
        <button
          type="button"
          className="response-config__link"
          onClick={() =>
            save({
              status: status.trim() ? Number(status.trim()) : null,
              body: body.trim() ? body : null,
              contentType: contentType.trim() || null,
            })
          }
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="response-config__link" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="response-config__error">{error}</p>}
    </div>
  );
}
