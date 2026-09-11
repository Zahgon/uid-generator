/*
 * Replacement for the `dataSource` / `abstractDataSource` beans in
 * `mybatis-spring.xml`: pick a driver from the `jdbc.url` scheme, the way
 * Spring picks one from `${mysql.driver}`.
 */

import type { SqlSession } from './sql-session.js';
import type { Properties } from './properties.js';
import { requireProperty } from './properties.js';
import { openMysqlSqlSession } from './mysql-sql-session.js';
import { openSqliteSqlSession } from './sqlite-sql-session.js';

/** Open the session the configured `jdbc.url` asks for. */
export async function openSqlSession(properties: Properties): Promise<SqlSession> {
  const url = requireProperty(properties, 'jdbc.url');
  if (url.startsWith('jdbc:sqlite:')) {
    return openSqliteSqlSession(properties);
  }
  if (url.startsWith('jdbc:mysql:')) {
    return openMysqlSqlSession(properties);
  }
  throw new Error(`Unsupported JDBC url: ${url}`);
}
