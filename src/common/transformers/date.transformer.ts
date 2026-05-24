import { ValueTransformer } from 'typeorm';

const isMongoDB = (): boolean => process.env.DATABASE_TYPE === 'mongodb';
const isPostgres = (): boolean => process.env.DATABASE_TYPE === 'postgres';

/**
 * Cross-database date transformer.
 * - SQLite stores as ISO string TEXT, transformer converts to/from Date
 * - PostgreSQL stores as native timestamp, driver returns Date directly
 * - MongoDB uses native Date objects, no transformation needed
 */
export const DateTransformer: ValueTransformer = {
  from: (value: string | Date | null): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    // MongoDB may return string in some cases, convert to Date
    return new Date(value);
  },
  to: (value: Date | null): string | Date | null => {
    if (!value) return null;
    if (value instanceof Date) {
      // MongoDB and PostgreSQL use native Date objects
      // SQLite needs ISO string format
      if (isMongoDB() || isPostgres()) {
        return value;
      }
      return value.toISOString();
    }
    return value;
  },
};
