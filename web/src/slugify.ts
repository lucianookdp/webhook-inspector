// Normalizes free-typed input into the shape the server's slug validation
// accepts (id.js's SLUG_PATTERN on the server: lowercase letters, digits and
// internal hyphens) — applied live as the user types, so what's shown in the
// input is always exactly what "Save" will send, rather than surprising them
// with a validation error over spaces or capitals they didn't think to avoid.
export function slugify(input: string): string {
  const collapsed = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Re-strip after the length cap: a cut that lands right after a hyphen
  // would otherwise leave one trailing.
  return collapsed.slice(0, 32).replace(/-+$/g, '');
}
