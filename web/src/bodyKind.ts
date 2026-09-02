export type BodyKind = 'empty' | 'binary' | 'json' | 'form' | 'xml' | 'text';

function looksLikeFormEncoded(body: string): boolean {
  if (body.includes('\n') || body.includes('<') || body.includes('{')) return false;
  return /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body);
}

export function detectBodyKind(row: {
  body: string | null;
  body_is_binary: boolean;
  content_type: string | null;
}): BodyKind {
  if (row.body_is_binary) return 'binary';
  if (row.body === null || row.body === '') return 'empty';

  const trimmed = row.body.trim();
  const contentType = (row.content_type ?? '').toLowerCase();

  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('x-www-form-urlencoded')) return 'form';

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // fall through — looked like JSON but wasn't valid
    }
  }
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return 'xml';
  if (looksLikeFormEncoded(trimmed)) return 'form';
  return 'text';
}

export function parseFormBody(body: string): Array<[string, string]> {
  const params = new URLSearchParams(body);
  return [...params.entries()];
}

const MAX_XML_OUTPUT_CHARS = 50_000;
const MAX_XML_DEPTH = 40;

// A best-effort reformatter, not a real parser — it only needs to make
// well-formed XML readable, and to give up cleanly (rather than hang or
// blow the stack) on anything adversarial, since the input is untrusted
// and unbounded in structure even though its byte size is capped upstream.
export function prettyPrintXml(xml: string): string {
  const withBreaks = xml.replace(/></g, '>\n<');
  const lines = withBreaks.split('\n');
  let output = '';
  let depth = 0;

  for (const rawLine of lines) {
    if (output.length > MAX_XML_OUTPUT_CHARS) return `${output}\n… output truncated`;

    const line = rawLine.trim();
    if (!line) continue;

    const isClosingTag = line.startsWith('</');
    const isSelfContained = /\/>$/.test(line) || line.startsWith('<?') || line.startsWith('<!');
    const isOpeningTag = /^<[^/!?][^>]*[^/]>$/.test(line);

    if (isClosingTag && depth > 0) depth -= 1;
    if (depth > MAX_XML_DEPTH) return `${output}${'  '.repeat(MAX_XML_DEPTH)}… max depth reached`;

    output += `${'  '.repeat(depth)}${line}\n`;

    if (isOpeningTag && !isSelfContained) depth += 1;
  }

  return output;
}

export function stringifyFieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyFieldValue).join(', ');
  return JSON.stringify(value);
}
