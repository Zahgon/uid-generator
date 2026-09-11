/*
 * Tests for worker-id assignment: the entity, the enum, the two SQL statements
 * ported out of the MyBatis mapper, and the environment probes.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { WorkerNodeEntity } from '../src/worker/entity/worker-node-entity.js';
import { WorkerNodeType, WorkerNodeTypeClass } from '../src/worker/worker-node-type.js';
import { EnumUtils } from '../src/utils/enum-utils.js';
import { DisposableWorkerIdAssigner } from '../src/worker/disposable-worker-id-assigner.js';
import type { WorkerNodeDAO } from '../src/worker/dao/worker-node-dao.js';
import {
  SqlWorkerNodeDAO, addWorkerNodeSql, getWorkerNodeByHostPortSql, mapWorkerNode,
} from '../src/worker/dao/sql-worker-node-dao.js';
import { MYSQL_DIALECT, SQLITE_DIALECT } from '../src/db/sql-session.js';
import type { InsertResult, Row, SqlSession } from '../src/db/sql-session.js';
import { MysqlSqlSession, parseMysqlJdbcUrl } from '../src/db/mysql-sql-session.js';
import type { MysqlConnection } from '../src/db/mysql-sql-session.js';
import {
  SqliteSqlSession, WORKER_NODE_DDL, openDatabase, parseSqliteJdbcUrl,
} from '../src/db/sqlite-sql-session.js';
import { openSqlSession } from '../src/db/datasource.js';
import { DockerUtils } from '../src/utils/docker-utils.js';
import { NetUtils } from '../src/utils/net-utils.js';
import { Level, setRootLevel } from '../src/deps/slf4j/logger.js';

/**
 * Keep the component's own INFO chatter out of the test report. logback would
 * print it; the appender is not what these tests are about. An async body has
 * to be awaited inside the window, or the level is restored before it logs.
 */
async function quietly<T>(body: () => T | Promise<T>): Promise<T> {
  setRootLevel(Level.ERROR);
  try {
    return await body();
  } finally {
    setRootLevel(Level.DEBUG);
  }
}

function quietlySync<T>(body: () => T): T {
  setRootLevel(Level.ERROR);
  try {
    return body();
  } finally {
    setRootLevel(Level.DEBUG);
  }
}

function openMemorySession(): SqliteSqlSession {
  const database = openDatabase(':memory:');
  database.exec(WORKER_NODE_DDL);
  return new SqliteSqlSession(database);
}

describe('WorkerNodeEntity', () => {
  test('starts on the Java field defaults', () => {
    const entity = new WorkerNodeEntity();
    expect(entity.getId()).toBe(0n);
    expect(entity.getHostName()).toBeNull();
    expect(entity.getPort()).toBeNull();
    expect(entity.getType()).toBe(0);
    expect(entity.getLaunchDate()).toBeInstanceOf(Date);
    expect(entity.getCreated()).toBeNull();
    expect(entity.getModified()).toBeNull();
  });

  test('toString reproduces the line the JVM baseline logged', () => {
    const entity = new WorkerNodeEntity();
    entity.setId(1n);
    entity.setHostName('172.17.0.7');
    entity.setPort('1788848465175-58087');
    entity.setType(2);
    entity.setLaunchDateDate(new Date(Date.UTC(2026, 8, 8, 6, 21, 5)));
    expect(entity.toString()).toBe(
      'WorkerNodeEntity[id=1,hostName=172.17.0.7,port=1788848465175-58087,type=2,'
      + 'launchDate=Tue Sep 08 06:21:05 UTC 2026,created=<null>,modified=<null>]',
    );
  });

  test('the setters round-trip, including the misspelled launch-date one', () => {
    const entity = new WorkerNodeEntity();
    const created = new Date(0);
    entity.setCreated(created);
    entity.setModified(created);
    entity.setLaunchDateDate(null);
    expect(entity.getCreated()).toBe(created);
    expect(entity.getModified()).toBe(created);
    expect(entity.getLaunchDate()).toBeNull();
  });
});

describe('WorkerNodeType', () => {
  test('CONTAINER is 1 and ACTUAL is 2, in that declaration order', () => {
    expect(WorkerNodeType.CONTAINER.value()).toBe(1);
    expect(WorkerNodeType.ACTUAL.value()).toBe(2);
    expect(WorkerNodeType.values().map((c) => c.name())).toEqual(['CONTAINER', 'ACTUAL']);
    expect(WorkerNodeType.CONTAINER.ordinal()).toBe(0);
    expect(WorkerNodeType.ACTUAL.toString()).toBe('ACTUAL');
  });

  test('EnumUtils.parse finds the constant bound to a value', () => {
    expect(EnumUtils.parse(WorkerNodeTypeClass, 1)).toBe(WorkerNodeType.CONTAINER);
    expect(EnumUtils.parse(WorkerNodeTypeClass, 2)).toBe(WorkerNodeType.ACTUAL);
    expect(EnumUtils.parse(WorkerNodeTypeClass, 3)).toBeNull();
    expect(EnumUtils.parse<number, WorkerNodeType>(WorkerNodeTypeClass, null)).toBeNull();
    expect(() => EnumUtils.parse(null, 1)).toThrow('clz can not be null');
  });

  test('EnumUtils.valueOf is null-safe and otherwise strict', () => {
    expect(EnumUtils.valueOf(WorkerNodeTypeClass, null)).toBeNull();
    expect(EnumUtils.valueOf(WorkerNodeTypeClass, 'ACTUAL')).toBe(WorkerNodeType.ACTUAL);
    expect(() => EnumUtils.valueOf(WorkerNodeTypeClass, 'NOPE')).toThrow();
  });
});

describe('the WORKER_NODE statements', () => {
  test('the insert keeps the mapper column list, order and NOW() defaults', () => {
    expect(addWorkerNodeSql(MYSQL_DIALECT)).toBe(
      'INSERT INTO WORKER_NODE\n(HOST_NAME,\nPORT,\nTYPE,\nLAUNCH_DATE,\nMODIFIED,\nCREATED)\n'
      + 'VALUES (\n?,\n?,\n?,\n?,\nNOW(),\nNOW())',
    );
    expect(addWorkerNodeSql(SQLITE_DIALECT)).toContain('CURRENT_TIMESTAMP');
  });

  test('the select keeps the mapper column list and predicate', () => {
    expect(getWorkerNodeByHostPortSql(MYSQL_DIALECT)).toBe(
      'SELECT\nID,\nHOST_NAME,\nPORT,\nTYPE,\nLAUNCH_DATE,\nMODIFIED,\nCREATED\n'
      + 'FROM\nWORKER_NODE\nWHERE\nHOST_NAME = ? AND PORT = ?',
    );
  });

  test('the result map converts every column to its entity field type', () => {
    const row: Row = {
      ID: '42',
      HOST_NAME: '10.0.0.1',
      PORT: '1-2',
      TYPE: 2,
      LAUNCH_DATE: '2026-09-08',
      MODIFIED: null,
      CREATED: null,
    };
    const entity = mapWorkerNode(row);
    expect(entity.getId()).toBe(42n);
    expect(entity.getHostName()).toBe('10.0.0.1');
    expect(entity.getType()).toBe(2);
    expect(entity.getLaunchDate()?.getTime()).toBe(Date.UTC(2026, 8, 8));
    expect(entity.getModified()).toBeNull();
  });
});

describe('SqlWorkerNodeDAO', () => {
  test('the insert writes the generated key back into the entity', async () => {
    const session = openMemorySession();
    try {
      const dao = new SqlWorkerNodeDAO(session);
      const first = new WorkerNodeEntity();
      first.setHostName('10.0.0.1');
      first.setPort('1788848465175-58087');
      first.setType(2);
      await dao.addWorkerNode(first);
      expect(first.getId()).toBe(1n);

      const second = new WorkerNodeEntity();
      second.setHostName('10.0.0.2');
      second.setPort('1788848465176-1');
      second.setType(2);
      await dao.addWorkerNode(second);
      expect(second.getId()).toBe(2n);
    } finally {
      await session.close();
    }
  });

  test('the select finds the row the insert wrote, and nothing else', async () => {
    const session = openMemorySession();
    try {
      const dao = new SqlWorkerNodeDAO(session);
      const entity = new WorkerNodeEntity();
      entity.setHostName('10.0.0.1');
      entity.setPort('1788848465175-58087');
      entity.setType(1);
      await dao.addWorkerNode(entity);

      const found = await dao.getWorkerNodeByHostPort('10.0.0.1', '1788848465175-58087');
      expect(found?.getId()).toBe(1n);
      expect(found?.getType()).toBe(1);
      expect(found?.getHostName()).toBe('10.0.0.1');
      expect(await dao.getWorkerNodeByHostPort('10.0.0.9', 'nope')).toBeNull();
    } finally {
      await session.close();
    }
  });

  test('a failing insert rolls the transaction back', async () => {
    const session = openMemorySession();
    const attempted: string[] = [];
    const failing: SqlSession = {
      dialect: session.dialect,
      insert: (): Promise<InsertResult> => {
        attempted.push('insert');
        return Promise.reject(new Error('duplicate key'));
      },
      selectOne: () => Promise.resolve(null),
      transaction: async (work) => {
        attempted.push('begin');
        try {
          return await work();
        } catch (error) {
          attempted.push('rollback');
          throw error;
        }
      },
      close: () => Promise.resolve(),
    };
    try {
      const dao = new SqlWorkerNodeDAO(failing);
      await expect(dao.addWorkerNode(new WorkerNodeEntity())).rejects.toThrow('duplicate key');
      expect(attempted).toEqual(['begin', 'insert', 'rollback']);
    } finally {
      await session.close();
    }
  });
});

describe('sessions and JDBC urls', () => {
  test('parses a Connector/J url with and without an explicit port', () => {
    expect(parseMysqlJdbcUrl('jdbc:mysql://localhost:3307/uid?useUnicode=true'))
      .toEqual({ host: 'localhost', port: 3307, database: 'uid' });
    expect(parseMysqlJdbcUrl('jdbc:mysql://db/uid'))
      .toEqual({ host: 'db', port: 3306, database: 'uid' });
    expect(() => parseMysqlJdbcUrl('jdbc:postgresql://db/uid')).toThrow('Unsupported JDBC url');
  });

  test('parses a sqlite url, defaulting to an in-process database', () => {
    expect(parseSqliteJdbcUrl('jdbc:sqlite::memory:')).toBe(':memory:');
    expect(parseSqliteJdbcUrl('jdbc:sqlite:/tmp/uid.db')).toBe('/tmp/uid.db');
    expect(parseSqliteJdbcUrl('jdbc:sqlite:')).toBe(':memory:');
    expect(() => parseSqliteJdbcUrl('jdbc:mysql://db/uid')).toThrow('Unsupported JDBC url');
  });

  test('the datasource picks a driver from the url scheme', async () => {
    const session = await openSqlSession(new Map([['jdbc.url', 'jdbc:sqlite::memory:']]));
    expect(session.dialect).toBe(SQLITE_DIALECT);
    await session.close();
    await expect(openSqlSession(new Map([['jdbc.url', 'jdbc:h2:mem:uid']])))
      .rejects.toThrow('Unsupported JDBC url: jdbc:h2:mem:uid');
  });

  test('the mysql session reports insertId as the generated key', async () => {
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const connection: MysqlConnection = {
      query: (sql, values) => {
        calls.push({ sql, values });
        return Promise.resolve(sql.startsWith('SELECT')
          ? [[{ ID: 5, HOST_NAME: 'h', PORT: 'p', TYPE: 2, LAUNCH_DATE: '2026-09-08' }], null]
          : [{ insertId: 9 }, null]);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
      end: () => Promise.resolve(),
    };
    const session = new MysqlSqlSession(connection);
    expect(session.dialect).toBe(MYSQL_DIALECT);

    const dao = new SqlWorkerNodeDAO(session);
    const entity = new WorkerNodeEntity();
    entity.setHostName('h');
    entity.setPort('p');
    entity.setType(2);
    await dao.addWorkerNode(entity);
    expect(entity.getId()).toBe(9n);
    expect(calls[0]?.sql).toBe(addWorkerNodeSql(MYSQL_DIALECT));
    expect(calls[0]?.values.slice(0, 3)).toEqual(['h', 'p', 2]);

    expect((await dao.getWorkerNodeByHostPort('h', 'p'))?.getId()).toBe(5n);
    await session.close();
  });

  test('the mysql session rolls back a failing unit of work', async () => {
    const events: string[] = [];
    const connection: MysqlConnection = {
      query: () => Promise.reject(new Error('deadlock')),
      beginTransaction: () => { events.push('begin'); return Promise.resolve(); },
      commit: () => { events.push('commit'); return Promise.resolve(); },
      rollback: () => { events.push('rollback'); return Promise.resolve(); },
      end: () => { events.push('end'); return Promise.resolve(); },
    };
    const session = new MysqlSqlSession(connection);
    await expect(session.transaction(() => session.insert('INSERT', []))).rejects.toThrow('deadlock');
    expect(events).toEqual(['begin', 'rollback']);
    expect(await session.selectOne('SELECT', []).catch(() => 'failed')).toBe('failed');
  });
});

describe('DisposableWorkerIdAssigner', () => {
  const inserted: WorkerNodeEntity[] = [];
  const dao: WorkerNodeDAO = {
    addWorkerNode: (entity) => {
      inserted.push(entity);
      entity.setId(BigInt(inserted.length));
      return Promise.resolve();
    },
    getWorkerNodeByHostPort: () => Promise.resolve(null),
  };

  afterEach(() => {
    delete process.env['JPAAS_HOST'];
    delete process.env['JPAAS_HTTP_PORT'];
    delete process.env['JPAAS_HOST_PORT_8080'];
    DockerUtils.retrieveFromEnv();
    inserted.length = 0;
  });

  test('off a container it records the local ip and a timestamp-random port', async () => {
    const workerId = await quietly(() => new DisposableWorkerIdAssigner(dao).assignWorkerId());
    expect(workerId).toBe(1n);
    const entity = inserted[0]!;
    expect(entity.getType()).toBe(WorkerNodeType.ACTUAL.value());
    expect(entity.getHostName()).toBe(NetUtils.getLocalAddress());
    expect(entity.getPort()).toMatch(/^\d{13}-\d{1,5}$/);
    expect(entity.getLaunchDate()).toBeInstanceOf(Date);
  });

  test('in a container it records the JPAAS host and port', async () => {
    process.env['JPAAS_HOST'] = 'container-7';
    process.env['JPAAS_HTTP_PORT'] = '8080';
    DockerUtils.retrieveFromEnv();
    expect(DockerUtils.isDocker()).toBe(true);

    await quietly(() => new DisposableWorkerIdAssigner(dao).assignWorkerId());
    const entity = inserted[0]!;
    expect(entity.getType()).toBe(WorkerNodeType.CONTAINER.value());
    expect(entity.getHostName()).toBe('container-7');
    expect(entity.getPort()).toBe('8080');
  });

  test('successive assignments take successive generated keys', async () => {
    const assigner = new DisposableWorkerIdAssigner(dao);
    await quietly(() => assigner.assignWorkerId());
    expect(await quietly(() => assigner.assignWorkerId())).toBe(2n);
  });
});

describe('DockerUtils', () => {
  afterEach(() => {
    delete process.env['JPAAS_HOST'];
    delete process.env['JPAAS_HTTP_PORT'];
    delete process.env['JPAAS_HOST_PORT_8080'];
    DockerUtils.retrieveFromEnv();
  });

  test('neither variable set means not a container', () => {
    DockerUtils.retrieveFromEnv();
    expect(DockerUtils.isDocker()).toBe(false);
    expect(DockerUtils.getDockerHost()).toBe('');
    expect(DockerUtils.getDockerPort()).toBe('');
  });

  test('falls back to JPAAS_HOST_PORT_8080 when JPAAS_HTTP_PORT is blank', () => {
    process.env['JPAAS_HOST'] = 'container-7';
    process.env['JPAAS_HTTP_PORT'] = '   ';
    process.env['JPAAS_HOST_PORT_8080'] = '18080';
    DockerUtils.retrieveFromEnv();
    expect(DockerUtils.isDocker()).toBe(true);
    expect(DockerUtils.getDockerPort()).toBe('18080');
  });

  test('exactly one of host and port is a configuration error', () => {
    process.env['JPAAS_HOST'] = 'container-7';
    expect(() => { quietlySync(() => { DockerUtils.retrieveFromEnv(); }); })
      .toThrow('Missing host or port from env for Docker. host:container-7, port:');
  });
});

describe('NetUtils', () => {
  test('resolves a routable local address once, at module load', () => {
    const address = NetUtils.getLocalAddress();
    expect(address).toBe(NetUtils.getLocalAddress());
    expect(address).not.toMatch(/^127\./);
    expect(address).not.toBe('::1');
    expect(address).not.toMatch(/^169\.254\./);
    expect(address).not.toMatch(/^fe[89ab]/i);
    expect(NetUtils.getLocalInetAddress().getHostAddress()).toBe(address);
  });
});
