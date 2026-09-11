/*
 * Port of `src/main/resources/META-INF/mybatis/mapper/WORKER_NODE.xml`.
 *
 * MyBatis kept the two statements and the column-to-field result map in XML;
 * they live here instead, in the only implementation that uses them. The SQL
 * text, the column list, the column order and the `NOW()` defaults are
 * unchanged, because a deployment's `WORKER_NODE` table is shared with
 * unmigrated instances of this component.
 */

import { javaToString } from '../../deps/java/to-string.js';
import type { Dialect, Row, SqlSession } from '../../db/sql-session.js';
import { WorkerNodeEntity } from '../entity/worker-node-entity.js';
import type { WorkerNodeDAO } from './worker-node-dao.js';

/** The mapper's `addWorkerNode` insert, for the given dialect. */
export function addWorkerNodeSql(dialect: Dialect): string {
  return 'INSERT INTO WORKER_NODE\n'
    + '(HOST_NAME,\n'
    + 'PORT,\n'
    + 'TYPE,\n'
    + 'LAUNCH_DATE,\n'
    + 'MODIFIED,\n'
    + 'CREATED)\n'
    + 'VALUES (\n'
    + `${dialect.placeholder(1)},\n`
    + `${dialect.placeholder(2)},\n`
    + `${dialect.placeholder(3)},\n`
    + `${dialect.placeholder(4)},\n`
    + `${dialect.now},\n`
    + `${dialect.now})`;
}

/** The mapper's `getWorkerNodeByHostPort` select, for the given dialect. */
export function getWorkerNodeByHostPortSql(dialect: Dialect): string {
  return 'SELECT\n'
    + 'ID,\n'
    + 'HOST_NAME,\n'
    + 'PORT,\n'
    + 'TYPE,\n'
    + 'LAUNCH_DATE,\n'
    + 'MODIFIED,\n'
    + 'CREATED\n'
    + 'FROM\n'
    + 'WORKER_NODE\n'
    + 'WHERE\n'
    + `HOST_NAME = ${dialect.placeholder(1)} AND PORT = ${dialect.placeholder(2)}`;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }
  return null;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return BigInt(value);
  }
  return 0n;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'string') {
    return Number(value);
  }
  return 0;
}

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : javaToString(value);
}

/** The mapper's `workerNodeRes` result map. */
export function mapWorkerNode(row: Row): WorkerNodeEntity {
  const entity = new WorkerNodeEntity();
  entity.setId(toBigInt(row['ID']));
  entity.setHostName(toStringOrNull(row['HOST_NAME']));
  entity.setPort(toStringOrNull(row['PORT']));
  entity.setType(toNumber(row['TYPE']));
  entity.setLaunchDateDate(toDate(row['LAUNCH_DATE']));
  entity.setModified(toDate(row['MODIFIED']));
  entity.setCreated(toDate(row['CREATED']));
  return entity;
}

/**
 * `WorkerNodeDAO` over a `SqlSession`. The Spring original had MyBatis generate
 * this class from the mapper interface plus the XML.
 */
export class SqlWorkerNodeDAO implements WorkerNodeDAO {
  private readonly sqlSession: SqlSession;

  constructor(sqlSession: SqlSession) {
    this.sqlSession = sqlSession;
  }

  async getWorkerNodeByHostPort(host: string, port: string): Promise<WorkerNodeEntity | null> {
    const row = await this.sqlSession.selectOne(
      getWorkerNodeByHostPortSql(this.sqlSession.dialect),
      [host, port],
    );
    return row === null ? null : mapWorkerNode(row);
  }

  /**
   * The insert runs in a transaction because `DisposableWorkerIdAssigner.assignWorkerId`
   * carries `@Transactional` and this insert is the whole of its work.
   */
  async addWorkerNode(workerNodeEntity: WorkerNodeEntity): Promise<void> {
    const launchDate = workerNodeEntity.getLaunchDate();
    const result = await this.sqlSession.transaction(() => this.sqlSession.insert(
      addWorkerNodeSql(this.sqlSession.dialect),
      [
        workerNodeEntity.getHostName(),
        workerNodeEntity.getPort(),
        workerNodeEntity.getType(),
        launchDate,
      ],
    ));
    // MyBatis' useGeneratedKeys/keyProperty="id" writes the key back in place.
    workerNodeEntity.setId(result.generatedKey);
  }
}
