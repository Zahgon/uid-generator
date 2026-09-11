/*
 * Replacement for the MyBatis / mybatis-spring / Druid stack.
 *
 * The original reaches the database through a MyBatis mapper XML, a
 * `SqlSessionTemplate`, a Druid `DataSource` and Spring's
 * `DataSourceTransactionManager`. Almost none of that is observable: what the
 * component's contract actually contains is two SQL statements, the fact that
 * the insert reads back the generated auto-increment key, and the fact that the
 * insert runs inside a transaction. This interface is that contract and nothing
 * more.
 */

/** The parts of SQL dialect the two statements depend on. */
export interface Dialect {
  /** The expression the mapper spells `NOW()`. */
  readonly now: string;
  /** Positional parameter placeholder for parameter `index` (1-based). */
  placeholder(index: number): string;
}

export const MYSQL_DIALECT: Dialect = {
  now: 'NOW()',
  placeholder: () => '?',
};

export const SQLITE_DIALECT: Dialect = {
  now: 'CURRENT_TIMESTAMP',
  placeholder: () => '?',
};

/** What an `INSERT` with `useGeneratedKeys` returns. */
export interface InsertResult {
  /** The generated auto-increment key, i.e. MyBatis' `keyProperty`. */
  readonly generatedKey: bigint;
}

/** One row, keyed by column name exactly as the database reports it. */
export type Row = Readonly<Record<string, unknown>>;

/**
 * The narrow slice of `org.apache.ibatis.session.SqlSession` this component
 * uses.
 */
export interface SqlSession {
  readonly dialect: Dialect;

  /** Execute an INSERT and return its generated key. */
  insert(sql: string, parameters: readonly unknown[]): Promise<InsertResult>;

  /** Execute a SELECT expected to match at most one row. */
  selectOne(sql: string, parameters: readonly unknown[]): Promise<Row | null>;

  /**
   * Run `work` inside a transaction, committing on return and rolling back on
   * throw. This is what `@Transactional` does for `assignWorkerId`.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;

  /** Release the underlying connection. */
  close(): Promise<void>;
}
