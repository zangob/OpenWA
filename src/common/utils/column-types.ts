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
 */

const isPostgres = (): boolean => process.env.DATABASE_TYPE === 'postgres';
const isMongoDB = (): boolean => process.env.DATABASE_TYPE === 'mongodb';

/**
 * Returns 'jsonb' for PostgreSQL, 'simple-json' for SQLite, or undefined for MongoDB.
 * MongoDB uses native objects, so no special column type is needed.
 */
export const jsonColumnType = (): 'jsonb' | 'simple-json' | undefined => {
  if (isMongoDB()) return undefined; // MongoDB uses native objects
  return isPostgres() ? 'jsonb' : 'simple-json';
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
