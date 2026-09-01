import { useState } from 'react';

// A captured body can be up to 256KB of attacker-controlled JSON — enough to
// pack in tens of thousands of tiny nodes or an absurd nesting depth. These
// caps stop the tree from painting more than a browser tab can handle in one
// frame, regardless of what shape the payload takes.
const MAX_NODES = 800;
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 200;
const MAX_STRING_LEN = 2000;

type Budget = { remaining: number };

function truncateString(value: string): string {
  return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}… (${value.length} chars)` : value;
}

function Primitive({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  return <span className="json-string">"{truncateString(value)}"</span>;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function JsonNode({
  name,
  value,
  depth,
  budget,
}: {
  name: string | null;
  value: unknown;
  depth: number;
  budget: Budget;
}) {
  const [collapsed, setCollapsed] = useState(depth > 0 && isContainer(value) && countEntries(value) > 20);

  if (budget.remaining <= 0) {
    return (
      <div className="json-node">
        {name !== null && <span className="json-key">{name}: </span>}
        <span className="json-truncated">… output truncated</span>
      </div>
    );
  }
  budget.remaining -= 1;

  if (depth > MAX_DEPTH) {
    return (
      <div className="json-node">
        {name !== null && <span className="json-key">{name}: </span>}
        <span className="json-truncated">… max depth reached</span>
      </div>
    );
  }

  if (!isContainer(value)) {
    return (
      <div className="json-node">
        {name !== null && <span className="json-key">{name}: </span>}
        <Primitive value={value as string | number | boolean | null} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i): [string, unknown] => [String(i), v]) : Object.entries(value);
  const shown = entries.slice(0, MAX_ARRAY_ITEMS);
  const hiddenCount = entries.length - shown.length;

  return (
    <div className="json-node">
      <button
        type="button"
        className="json-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      {name !== null && <span className="json-key">{name}: </span>}
      <span className="json-bracket">{isArray ? '[' : '{'}</span>
      {collapsed ? (
        <span className="json-collapsed-summary">
          {' '}
          {entries.length} {entries.length === 1 ? 'item' : 'items'}{' '}
        </span>
      ) : (
        <div className="json-children">
          {shown.map(([k, v]) => (
            <JsonNode key={k} name={isArray ? null : k} value={v} depth={depth + 1} budget={budget} />
          ))}
          {hiddenCount > 0 && <div className="json-truncated">… {hiddenCount} more</div>}
        </div>
      )}
      <span className="json-bracket">{isArray ? ']' : '}'}</span>
    </div>
  );
}

function countEntries(value: Record<string, unknown> | unknown[]): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

export function JsonView({ value }: { value: unknown }) {
  const budget: Budget = { remaining: MAX_NODES };
  return (
    <div className="json-view json-view--tree">
      <JsonNode name={null} value={value} depth={0} budget={budget} />
    </div>
  );
}
