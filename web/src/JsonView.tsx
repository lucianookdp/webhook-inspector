import type { ReactNode } from 'react';

// Matches string literals (keys get an attached trailing colon), booleans,
// null, and numbers. Everything else (braces, brackets, commas, whitespace)
// is left as plain text between matches.
const TOKEN_RE = /"(?:\\u[0-9a-fA-F]{4}|\\.|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function classify(token: string): string {
  if (token.endsWith(':')) return 'json-key';
  if (token.startsWith('"')) return 'json-string';
  if (token === 'true' || token === 'false') return 'json-boolean';
  if (token === 'null') return 'json-null';
  return 'json-number';
}

export function JsonView({ value }: { value: unknown }) {
  const pretty = JSON.stringify(value, null, 2);
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of pretty.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(pretty.slice(lastIndex, index));
    const token = match[0];
    nodes.push(
      <span key={key++} className={classify(token)}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }
  if (lastIndex < pretty.length) nodes.push(pretty.slice(lastIndex));

  return <pre className="json-view">{nodes}</pre>;
}
