import { type KeyboardEvent, useRef } from 'react';
import { formatBytes, formatRelativeTime, methodClass } from './format';
import { RequestDetail } from './RequestDetail';
import type { RequestRow } from './types';

const ROW_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

export function RequestList({
  requests,
  selectedId,
  onSelect,
  newIds,
  now,
}: {
  requests: RequestRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  newIds: Set<string>;
  now: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!ROW_NAV_KEYS.has(event.key)) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.request-row') ?? []);
    const currentIndex = rows.indexOf(event.currentTarget);
    if (currentIndex === -1) return;
    event.preventDefault();

    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(currentIndex + 1, rows.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(currentIndex - 1, 0)
          : event.key === 'Home'
            ? 0
            : rows.length - 1;
    rows[nextIndex]?.focus();
  }

  return (
    <div className="request-list" ref={listRef}>
      <div className="request-list__header">
        <span>Method</span>
        <span>Path</span>
        <span className="request-list__header-size">Size</span>
        <span className="request-list__header-received">Received</span>
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
            onKeyDown={handleRowKeyDown}
            aria-expanded={selectedId === row.id}
          >
            <span className={`request-row__method ${methodClass(row.method)}`}>{row.method}</span>
            <span className="request-row__path">
              {row.path}
              {row.truncated && (
                <span className="request-row__flag" title="Body was truncated to 256 KB">
                  truncated
                </span>
              )}
              {row.body_is_binary && (
                <span className="request-row__flag" title="Body stored as base64-encoded binary">
                  binary
                </span>
              )}
            </span>
            <span className="request-row__meta">
              <span className="request-row__size">{formatBytes(row.size_bytes)}</span>
              <span className="request-row__time">{formatRelativeTime(row.received_at, now)}</span>
            </span>
          </button>
          {selectedId === row.id && <RequestDetail row={row} />}
        </div>
      ))}
    </div>
  );
}
