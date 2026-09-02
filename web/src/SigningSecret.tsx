import { useState } from 'react';
import { setSigningSecret } from './api';

export function SigningSecret({
  endpointId,
  configured,
  onChange,
}: {
  endpointId: string;
  configured: boolean;
  onChange: (configured: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(secret: string | null) {
    setSaving(true);
    setError(null);
    try {
      await setSigningSecret(endpointId, secret);
      onChange(secret !== null);
      setEditing(false);
      setValue('');
    } catch {
      setError('Could not save. Check your connection.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="signing-secret">
        <span className="signing-secret__status">Signature verification: {configured ? 'on' : 'off'}</span>
        <button type="button" className="signing-secret__link" onClick={() => setEditing(true)}>
          {configured ? 'Change secret' : 'Set a secret'}
        </button>
        {configured && (
          <button type="button" className="signing-secret__link" onClick={() => save(null)} disabled={saving}>
            Turn off
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="signing-secret">
      <input
        type="password"
        className="signing-secret__input"
        placeholder="Signing secret"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        // biome-ignore lint/a11y/noAutofocus: opened by an explicit click on "Set/Change secret", not on page load
        autoFocus
      />
      <button
        type="button"
        className="signing-secret__link"
        onClick={() => save(value.trim())}
        disabled={saving || !value.trim()}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        className="signing-secret__link"
        onClick={() => {
          setEditing(false);
          setValue('');
        }}
      >
        Cancel
      </button>
      {error && <p className="signing-secret__error">{error}</p>}
    </div>
  );
}
