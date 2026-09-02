// Shared by db.js and migrate.ts, which each resolve their own connection
// string and can't both depend on config.js (migrate.ts's MIGRATION_DATABASE_URL
// fallback logic doesn't fit config.js's single required DATABASE_URL).
export function buildDatabaseSsl(
  connectionString: string,
  options: { insecureTls: boolean; caCert: string | undefined },
): false | { rejectUnauthorized: boolean; ca?: string } {
  if (connectionString.includes('localhost')) return false;
  if (options.insecureTls) return { rejectUnauthorized: false };
  // rejectUnauthorized: true verifies against Node's default trust store,
  // which already works for a provider using a publicly-trusted CA; caCert
  // adds one more trusted CA for a provider that isn't.
  return { rejectUnauthorized: true, ca: options.caCert };
}
