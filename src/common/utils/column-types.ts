/**
 * Cross-database column type helpers.
 *
 * SQLite lacks native JSON and timestamp types, so we use `simple-json`
 * (JSON.stringify stored as TEXT) and `text` with DateTransformer.
 *
 * PostgreSQL has native `jsonb` and `timestamp` types with better
 * indexing and query performance.
 *
 * MongoDB uses native objects for JSON and Date, no special handling needed.
 *
 * DATA CONNECTION ONLY. These resolve the dialect of the *data* connection from the global
 * `DATABASE_TYPE` env var. Use them only on entities bound to the data connection. Entities on the
 * MAIN connection (auth, audit) are ALWAYS SQLite — it is hardcoded `type: 'better-sqlite3'` in
 * app.module.ts regardless of DATABASE_TYPE — so they must hardcode `simple-json` / `datetime`
 * (see audit-log.entity.ts) and must NOT call these helpers, or a Postgres deployment would emit a
 * `jsonb`/`timestamp` column on the always-SQLite main DB.
 */

const isPostgres = (): boolean => process.env.DATABASE_TYPE === 'postgres';
const isMongoDB = (): boolean => process.env.DATABASE_TYPE === 'mongodb';

/**
 * 'simple-json' (TypeORM JSON.stringify/parse over a `text` column) on SQLite and Postgres;
 * undefined for MongoDB (native objects, no column type needed).
 *
 * The baseline migration created these columns as `text` on Postgres too (never `jsonb`). The pg
 * driver only auto-parses real json/jsonb columns, so a `jsonb`-typed entity reading the actual
 * `text` column hands back a RAW string — e.g. webhook.events comes through as the string
 * '["message.received"]', and the dashboard's events.map() throws (full-page crash). 'simple-json'
 * parses on read regardless of dialect, matching the real columns. No native jsonb queries exist
 * (all JSON filtering is done in JS), so nothing is lost.
 */
export const jsonColumnType = (): 'simple-json' | undefined => {
  if (isMongoDB()) return undefined; // MongoDB uses native objects
  return 'simple-json';
};

/**
 * Returns 'timestamp' for PostgreSQL, 'text' for SQLite, or undefined for MongoDB.
 * MongoDB uses native Date objects, so no special column type is needed.
 * Use with DateTransformer for SQLite compatibility.
 */
export const dateColumnType = (): 'timestamp' | 'text' | undefined => {
  if (isMongoDB()) return undefined; // MongoDB uses native Date
  return isPostgres() ? 'timestamp' : 'text';
};
