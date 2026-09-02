import { useState } from 'react';
import { ApiError, setSlug } from './api';
import { slugify } from './slugify';

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return 'That name is already taken.';
  if (err instanceof ApiError && err.status === 400) return 'Use 3-32 lowercase letters, digits or hyphens.';
  return 'Could not save. Check your connection.';
}

export function EndpointSlug({
  endpointId,
  slug,
  onChange,
}: {
  endpointId: string;
  slug: string | null;
  onChange: (slug: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    try {
      const saved = await setSlug(endpointId, next);
      onChange(saved);
      setEditing(false);
      setValue('');
    } catch (err) {
      setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="endpoint-slug">
        <span className="endpoint-slug__status">Custom name: {slug ?? 'off'}</span>
        <button
          type="button"
          className="endpoint-slug__link"
          onClick={() => {
            setValue(slug ?? '');
            setError(null);
            setEditing(true);
          }}
        >
          {slug ? 'Change name' : 'Set a name'}
        </button>
        {slug && (
          <button type="button" className="endpoint-slug__link" onClick={() => save(null)} disabled={saving}>
            Remove
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="endpoint-slug">
      <input
        type="text"
        className="endpoint-slug__input"
        placeholder="my-webhook"
        value={value}
        onChange={(event) => setValue(slugify(event.target.value))}
        maxLength={32}
        // biome-ignore lint/a11y/noAutofocus: opened by an explicit click on "Set/Change name", not on page load
        autoFocus
      />
      <button type="button" className="endpoint-slug__link" onClick={() => save(value)} disabled={saving || !value}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        className="endpoint-slug__link"
        onClick={() => {
          setEditing(false);
          setValue('');
        }}
      >
        Cancel
      </button>
      {error && <p className="endpoint-slug__error">{error}</p>}
    </div>
  );
}
