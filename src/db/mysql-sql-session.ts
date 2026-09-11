/*
 * Replacement for MySQL Connector/J + the Druid connection pool.
 *
 * `mysql2` speaks the same wire protocol and reports `insertId` for an
 * `AUTO_INCREMENT` key, which is what MyBatis' `useGeneratedKeys` needs.
 */

import mysql from 'mysql2/promise';
import type { Dialect, InsertResult, Row, SqlSession } from './sql-session.js';
import { MYSQL_DIALECT } from './sql-session.js';
import type { Properties } from './properties.js';
import { requireProperty } from './properties.js';

/** The mysql2 surface this session uses; narrowed so tests can substitute it. */
export interface MysqlConnection {
  query(sql: string, values: readonly unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
}

interface OkPacketLike {
  insertId?: number | bigint;
}

export class MysqlSqlSession implements SqlSession {
  readonly dialect: Dialect = MYSQL_DIALECT;

  private readonly connection: MysqlConnection;

  constructor(connection: MysqlConnection) {
    this.connection = connection;
  }

  async insert(sql: string, parameters: readonly unknown[]): Promise<InsertResult> {
    const [result] = await this.connection.query(sql, parameters);
    const insertId = (result as OkPacketLike).insertId;
    return { generatedKey: insertId === undefined ? 0n : BigInt(insertId) };
  }

  async selectOne(sql: string, parameters: readonly unknown[]): Promise<Row | null> {
    const [rows] = await this.connection.query(sql, parameters);
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }
    return rows[0] as Row;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.connection.beginTransaction();
    try {
      const result = await work();
      await this.connection.commit();
      return result;
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.connection.end();
  }
}

/** Parse a Connector/J URL, `jdbc:mysql://host:port/database?params`. */
export function parseMysqlJdbcUrl(url: string): { host: string; port: number; database: string } {
  const match = /^jdbc:mysql:\/\/([^/:?]+)(?::(\d+))?\/([^?]*)/.exec(url);
  if (match === null) {
    throw new Error(`Unsupported JDBC url: ${url}`);
  }
  return {
    host: match[1]!,
    port: match[2] === undefined ? 3306 : Number(match[2]),
    database: match[3] ?? '',
  };
}

/** The connection settings the Druid datasource bean's properties map to. */
export interface MysqlConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** Keep a `DATE` column as the day it holds, not a shifted instant. */
  readonly dateStrings: readonly ['DATE'];
}

/** Translate `mysql.properties` into connection settings. */
export function mysqlConnectionOptions(properties: Properties): MysqlConnectionOptions {
  const { host, port, database } = parseMysqlJdbcUrl(requireProperty(properties, 'jdbc.url'));
  return {
    host,
    port,
    database,
    user: requireProperty(properties, 'jdbc.username'),
    password: requireProperty(properties, 'jdbc.password'),
    dateStrings: ['DATE'],
  };
}

/** Opens the driver connection; substitutable so the wiring above can be tested. */
export type MysqlConnector = (options: MysqlConnectionOptions) => Promise<MysqlConnection>;

const defaultConnector: MysqlConnector = async (options) =>
  await mysql.createConnection({ ...options, dateStrings: [...options.dateStrings] }) as unknown as MysqlConnection;

/**
 * Build a session from the same `mysql.properties` keys the Spring datasource
 * bean reads: `jdbc.url`, `jdbc.username`, `jdbc.password`.
 */
export async function openMysqlSqlSession(
  properties: Properties,
  connect: MysqlConnector = defaultConnector,
): Promise<MysqlSqlSession> {
  return new MysqlSqlSession(await connect(mysqlConnectionOptions(properties)));
}
