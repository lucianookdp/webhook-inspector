// Matches the id.js alphabet and length exactly (see ID_LENGTH there). Every
// route keyed by endpoint id validates against this before the id ever
// reaches a query, rather than relying on a malformed id simply failing to
// match a row.
export const endpointIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9]{12}$' },
  },
} as const;

// limit/cursor are re-parsed and semantically validated in the handler
// (routes/endpoints.js) — decodeCursor rejects anything that doesn't decode
// to the expected shape, and an out-of-range limit falls back to the
// default. This schema is the first line of defense: reject anything wildly
// oversized or non-numeric before it reaches that logic at all.
export const requestsQuerystringSchema = {
  type: 'object',
  properties: {
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
    cursor: { type: 'string', maxLength: 512 },
  },
} as const;
