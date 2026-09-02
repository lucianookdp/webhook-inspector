-- Aggregate, day-granularity usage counters — deliberately decoupled from
-- endpoints/requests, which are deleted (not soft-deleted) on expiry and
-- cleanup. Without this, "is anyone actually using this" would be
-- unanswerable a day after the fact. Holds only counts, no ids or content,
-- so it never needs to expire and doesn't add anything to what's already
-- documented in the README about what gets stored and why.
CREATE TABLE IF NOT EXISTS daily_stats (
  day date PRIMARY KEY,
  endpoints_created integer NOT NULL DEFAULT 0,
  requests_captured integer NOT NULL DEFAULT 0
);
