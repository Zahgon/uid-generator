/*
 * A `SqlSession` over Node's built-in SQLite.
 *
 * The upstream project ships `mysql.properties` with placeholder credentials
 * (`jdbc:mysql://localhost:xxxx/xxxx`) and tells the reader to point it at a
 * MySQL server of their own — so its own test suite cannot run anywhere
 * unattended. `node:sqlite` needs no server and no dependency, so pointing
 * `jdbc.url` at `jdbc:sqlite:…` runs the real DAO, the real statements and the
 * real generated-key read-back without one.
 *
 * MySQL stays the production target: `WORKER_NODE.sql` is MySQL DDL and a
 * deployment shares that table across instances.
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Dialect, InsertResult, Row, SqlSession } from './sql-session.js';
import { SQLITE_DIALECT } from './sql-session.js';
import type { Properties } from './properties.js';
import { requireProperty } from './properties.js';
import { javaToString } from '../deps/java/to-string.js';
import { formatPattern } from '../deps/java/java-date.js';

/**
 * `node:sqlite` is deliberately kept out of `module.builtinModules` while it is
 * experimental, so bundlers — Vite among them — do not recognise the specifier
 * as a builtin and try to resolve it on disk. Loading it through `createRequire`
 * keeps the specifier opaque to them; the type-only import above still gives
 * full typing.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};

export type { DatabaseSyncType };

/** Open a SQLite database, whatever the surrounding bundler thinks of the specifier. */
export function openDatabase(path: string): DatabaseSyncType {
  return new DatabaseSync(path);
}

/** `WORKER_NODE.sql` in SQLite's spelling of the same schema. */
export const WORKER_NODE_DDL = `CREATE TABLE IF NOT EXISTS WORKER_NODE
(
ID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
HOST_NAME VARCHAR(64) NOT NULL,
PORT VARCHAR(64) NOT NULL,
TYPE INT NOT NULL,
LAUNCH_DATE DATE NOT NULL,
MODIFIED TIMESTAMP NOT NULL,
CREATED TIMESTAMP NOT NULL
)`;

type SqliteParameter = string | number | bigint | null | Uint8Array;

function bind(value: unknown): SqliteParameter {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    // A `DATE` column: the JDBC driver sends the day, not the instant.
    return formatPattern(value, 'yyyy-MM-dd');
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  return javaToString(value);
}

export class SqliteSqlSession implements SqlSession {
  readonly dialect: Dialect = SQLITE_DIALECT;

  private readonly database: DatabaseSyncType;

  constructor(database: DatabaseSyncType) {
    this.database = database;
  }

  insert(sql: string, parameters: readonly unknown[]): Promise<InsertResult> {
    const result = this.database.prepare(sql).run(...parameters.map(bind));
    return Promise.resolve({ generatedKey: BigInt(result.lastInsertRowid) });
  }

  selectOne(sql: string, parameters: readonly unknown[]): Promise<Row | null> {
    const row = this.database.prepare(sql).get(...parameters.map(bind));
    return Promise.resolve((row as Row | undefined) ?? null);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.database.exec('BEGIN');
    try {
      const result = await work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): Promise<void> {
    this.database.close();
    return Promise.resolve();
  }
}

/** Parse `jdbc:sqlite:<path>`; `:memory:` selects an in-process database. */
export function parseSqliteJdbcUrl(url: string): string {
  const match = /^jdbc:sqlite:(.*)$/.exec(url);
  if (match === null) {
    throw new Error(`Unsupported JDBC url: ${url}`);
  }
  const location = match[1] ?? '';
  return location.length === 0 ? ':memory:' : location;
}

/** Open a session and create `WORKER_NODE` if it is not there yet. */
export function openSqliteSqlSession(properties: Properties): SqliteSqlSession {
  const database = openDatabase(parseSqliteJdbcUrl(requireProperty(properties, 'jdbc.url')));
  database.exec(WORKER_NODE_DDL);
  return new SqliteSqlSession(database);
}
