/*
 * Port of `src/test/resources/uid/mybatis-spring.xml`.
 *
 * The XML wired a Druid `DataSource`, a MyBatis `SqlSessionFactory`, a
 * `MapperScannerConfigurer` that generated `WorkerNodeDAO`, a
 * `DataSourceTransactionManager`, and a `PropertiesFactoryBean` reading
 * `classpath:/uid/*.properties`. Here the same graph is built explicitly.
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadProperties } from '../../../src/db/properties.js';
import type { SqlSession } from '../../../src/db/sql-session.js';
import { openSqlSession } from '../../../src/db/datasource.js';
import { SqlWorkerNodeDAO } from '../../../src/worker/dao/sql-worker-node-dao.js';
import { DisposableWorkerIdAssigner } from '../../../src/worker/disposable-worker-id-assigner.js';

/** `classpath:/uid/*.properties`. */
export const UID_PROPERTIES_DIR = dirname(fileURLToPath(import.meta.url));

export interface MybatisContext {
  readonly sqlSession: SqlSession;
  readonly disposableWorkerIdAssigner: DisposableWorkerIdAssigner;
  close(): Promise<void>;
}

/** Build the datasource / mapper / assigner half of a test context. */
export async function createMybatisContext(): Promise<MybatisContext> {
  const properties = loadProperties(UID_PROPERTIES_DIR);
  const sqlSession = await openSqlSession(properties);
  const workerNodeDAO = new SqlWorkerNodeDAO(sqlSession);
  return {
    sqlSession,
    disposableWorkerIdAssigner: new DisposableWorkerIdAssigner(workerNodeDAO),
    close: () => sqlSession.close(),
  };
}
